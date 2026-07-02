import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, Repository } from 'typeorm';
import { DoctorSlot } from './entities/doctor-slot.entity';
import { Appointment } from './entities/appointment.entity';
import { Doctor } from '../doctors/entities/doctor.entity';
import { Patient } from '../patients/entities/patient.entity';
import { DoctorsService } from '../doctors/doctors.service';
import { PatientsService } from '../patients/patients.service';
import { AppointmentsGateway } from './appointments.gateway';
import { SlotStatus } from '../../common/enums/slot-status.enum';
import { AppointmentStatus } from '../../common/enums/appointment-status.enum';
import { UserRoleName } from '../../common/enums/role.enum';
import { CreateAppointmentDto } from './dto/create-appointment.dto';

const WORK_START_HOUR = 8;
const WORK_END_HOUR = 17;

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectRepository(DoctorSlot)
    private readonly doctorSlotRepository: Repository<DoctorSlot>,
    @InjectRepository(Appointment)
    private readonly appointmentRepository: Repository<Appointment>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly doctorsService: DoctorsService,
    private readonly patientsService: PatientsService,
    private readonly appointmentsGateway: AppointmentsGateway,
  ) {}

  // Semana laboral: lunes a sábado, siempre la semana en curso (sin adelantar ni consultar semanas pasadas)
  private getCurrentWeekRange(): { monday: string; saturday: string } {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = domingo
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

    const monday = new Date(today);
    monday.setDate(today.getDate() - diffToMonday);

    const saturday = new Date(monday);
    saturday.setDate(monday.getDate() + 5);

    const format = (date: Date) => date.toISOString().split('T')[0];

    return { monday: format(monday), saturday: format(saturday) };
  }

  // Se asegura que la semana en curso tenga horarios disponibles, generándolos bajo demanda si faltan
  private async ensureWeekSlots(
    doctorId: string,
    monday: string,
    saturday: string,
  ): Promise<void> {
    const existingSlots = await this.doctorSlotRepository.find({
      where: { doctorId, date: Between(monday, saturday) },
    });
    const existingKeys = new Set(
      existingSlots.map((slot) => `${slot.date}|${slot.startTime}`),
    );

    const start = new Date(`${monday}T00:00:00`);
    const slotsToCreate: DoctorSlot[] = [];

    for (let dayOffset = 0; dayOffset < 6; dayOffset++) {
      const currentDate = new Date(start);
      currentDate.setDate(start.getDate() + dayOffset);
      const dateStr = currentDate.toISOString().split('T')[0];

      for (let hour = WORK_START_HOUR; hour < WORK_END_HOUR; hour++) {
        const startTime = `${hour.toString().padStart(2, '0')}:00`;

        if (existingKeys.has(`${dateStr}|${startTime}`)) {
          continue;
        }

        const endTime = `${(hour + 1).toString().padStart(2, '0')}:00`;
        slotsToCreate.push(
          this.doctorSlotRepository.create({
            doctorId,
            date: dateStr,
            startTime,
            endTime,
          }),
        );
      }
    }

    if (slotsToCreate.length > 0) {
      await this.doctorSlotRepository.save(slotsToCreate);
    }
  }

  async getAvailableSlots(doctorId: string): Promise<DoctorSlot[]> {
    await this.doctorsService.findOne(doctorId);

    const { monday, saturday } = this.getCurrentWeekRange();
    await this.ensureWeekSlots(doctorId, monday, saturday);

    return this.doctorSlotRepository.find({
      where: {
        doctorId,
        status: SlotStatus.AVAILABLE,
        date: Between(monday, saturday),
      },
      order: { date: 'ASC', startTime: 'ASC' },
    });
  }

  async createAppointment(
    patientUserId: string,
    dto: CreateAppointmentDto,
  ): Promise<Appointment> {
    const { appointment, patient } = await this.dataSource.transaction(
      async (manager) => {
        // Lock pesimista: evita que dos pacientes reserven el mismo slot en una condición de carrera
        const slot = await manager.findOne(DoctorSlot, {
          where: { id: dto.slotId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!slot) {
          throw new NotFoundException('El horario solicitado no existe');
        }

        if (slot.status !== SlotStatus.AVAILABLE) {
          throw new ConflictException('El horario ya no está disponible');
        }

        const patient = await manager.findOne(Patient, {
          where: { userId: patientUserId },
        });

        if (!patient) {
          throw new NotFoundException('Paciente no encontrado');
        }

        const newAppointment = manager.create(Appointment, {
          doctorId: slot.doctorId,
          patientId: patient.id,
          slotId: slot.id,
          status: AppointmentStatus.PENDING,
          reason: dto.reason,
        });

        const savedAppointment = await manager.save(newAppointment);

        slot.status = SlotStatus.BOOKED;
        await manager.save(slot);

        return { appointment: savedAppointment, patient };
      },
    );

    const doctor = await this.doctorsService.findOne(appointment.doctorId);
    this.appointmentsGateway.notifyUser(doctor.userId, 'appointment:created', {
      appointmentId: appointment.id,
      patientName: patient.user.fullName,
      reason: appointment.reason,
    });

    return appointment;
  }

  async respondToAppointment(
    doctorUserId: string,
    appointmentId: string,
    decision: 'confirmed' | 'rejected',
  ): Promise<Appointment> {
    const appointment = await this.dataSource.transaction(async (manager) => {
      const appointment = await manager.findOne(Appointment, {
        where: { id: appointmentId },
      });

      if (!appointment) {
        throw new NotFoundException('Cita no encontrada');
      }

      const doctor = await manager.findOne(Doctor, {
        where: { userId: doctorUserId },
      });

      if (!doctor || doctor.id !== appointment.doctorId) {
        throw new ForbiddenException('No tiene permisos sobre esta cita');
      }

      if (appointment.status !== AppointmentStatus.PENDING) {
        throw new ConflictException(
          'La cita ya fue procesada y no puede modificarse',
        );
      }

      appointment.status =
        decision === 'confirmed'
          ? AppointmentStatus.CONFIRMED
          : AppointmentStatus.REJECTED;

      await manager.save(appointment);

      if (decision === 'rejected') {
        const slot = await manager.findOne(DoctorSlot, {
          where: { id: appointment.slotId },
        });

        if (slot) {
          slot.status = SlotStatus.AVAILABLE;
          await manager.save(slot);
        }
      }

      return appointment;
    });

    const patient = await this.patientsService.findOne(appointment.patientId);
    this.appointmentsGateway.notifyUser(
      patient.userId,
      'appointment:statusChanged',
      { appointmentId: appointment.id, status: appointment.status },
    );

    return appointment;
  }

  async rescheduleAppointment(
    doctorUserId: string,
    appointmentId: string,
    newSlotId: string,
  ): Promise<Appointment> {
    const { appointment, newSlot } = await this.dataSource.transaction(
      async (manager) => {
        const appointment = await manager.findOne(Appointment, {
          where: { id: appointmentId },
        });

        if (!appointment) {
          throw new NotFoundException('Cita no encontrada');
        }

        const doctor = await manager.findOne(Doctor, {
          where: { userId: doctorUserId },
        });

        if (!doctor || doctor.id !== appointment.doctorId) {
          throw new ForbiddenException('No tiene permisos sobre esta cita');
        }

        // Se bloquea el nuevo slot para que no pueda ser tomado por otra reserva mientras se reprograma
        const newSlot = await manager.findOne(DoctorSlot, {
          where: { id: newSlotId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!newSlot || newSlot.status !== SlotStatus.AVAILABLE) {
          throw new ConflictException('El nuevo horario no está disponible');
        }

        // El slot anterior se libera dentro de la misma transacción para no dejar horarios huérfanos si algo falla
        const oldSlot = await manager.findOne(DoctorSlot, {
          where: { id: appointment.slotId },
        });

        if (oldSlot) {
          oldSlot.status = SlotStatus.AVAILABLE;
          await manager.save(oldSlot);
        }

        newSlot.status = SlotStatus.BOOKED;
        await manager.save(newSlot);

        appointment.slotId = newSlot.id;
        await manager.save(appointment);

        return { appointment, newSlot };
      },
    );

    const patient = await this.patientsService.findOne(appointment.patientId);
    this.appointmentsGateway.notifyUser(
      patient.userId,
      'appointment:rescheduled',
      {
        appointmentId: appointment.id,
        date: newSlot.date,
        startTime: newSlot.startTime,
        endTime: newSlot.endTime,
      },
    );

    return appointment;
  }

  async cancelAppointment(
    userId: string,
    appointmentId: string,
  ): Promise<Appointment> {
    const { appointment, cancelledByDoctor } =
      await this.dataSource.transaction(async (manager) => {
        const appointment = await manager.findOne(Appointment, {
          where: { id: appointmentId },
        });

        if (!appointment) {
          throw new NotFoundException('Cita no encontrada');
        }

        // La cita puede cancelarla el médico o el paciente dueños de la cita, nadie más
        const doctor = await manager.findOne(Doctor, { where: { userId } });
        const patient = await manager.findOne(Patient, { where: { userId } });

        const isOwnerDoctor = !!doctor && doctor.id === appointment.doctorId;
        const isOwnerPatient =
          !!patient && patient.id === appointment.patientId;

        if (!isOwnerDoctor && !isOwnerPatient) {
          throw new ForbiddenException(
            'No tiene permisos para cancelar esta cita',
          );
        }

        appointment.status = AppointmentStatus.CANCELLED;
        await manager.save(appointment);

        const slot = await manager.findOne(DoctorSlot, {
          where: { id: appointment.slotId },
        });

        if (slot) {
          slot.status = SlotStatus.AVAILABLE;
          await manager.save(slot);
        }

        return { appointment, cancelledByDoctor: isOwnerDoctor };
      });

    // Se avisa a la otra parte (quien no canceló) de que la cita ya no va
    if (cancelledByDoctor) {
      const patient = await this.patientsService.findOne(appointment.patientId);
      this.appointmentsGateway.notifyUser(
        patient.userId,
        'appointment:statusChanged',
        { appointmentId: appointment.id, status: appointment.status },
      );
    } else {
      const doctor = await this.doctorsService.findOne(appointment.doctorId);
      this.appointmentsGateway.notifyUser(
        doctor.userId,
        'appointment:statusChanged',
        { appointmentId: appointment.id, status: appointment.status },
      );
    }

    return appointment;
  }

  async findMyAppointments(
    userId: string,
    role: UserRoleName,
  ): Promise<Appointment[]> {
    if (role === UserRoleName.DOCTOR) {
      const doctor = await this.doctorsService.findByUserId(userId);

      if (!doctor) {
        throw new NotFoundException('Médico no encontrado');
      }

      return this.appointmentRepository.find({
        where: { doctorId: doctor.id },
        relations: { slot: true, patient: { user: true } },
        order: { createdAt: 'DESC' },
      });
    }

    const patient = await this.patientsService.findByUserId(userId);

    if (!patient) {
      throw new NotFoundException('Paciente no encontrado');
    }

    return this.appointmentRepository.find({
      where: { patientId: patient.id },
      relations: { slot: true, doctor: { user: true } },
      order: { createdAt: 'DESC' },
    });
  }
}
