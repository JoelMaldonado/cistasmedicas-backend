import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Doctor } from '../../doctors/entities/doctor.entity';
import { Patient } from '../../patients/entities/patient.entity';
import { DoctorSlot } from './doctor-slot.entity';
import { AppointmentStatus } from '../../../common/enums/appointment-status.enum';

@Entity('appointments')
export class Appointment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'doctor_id' })
  doctorId: string;

  @Column({ name: 'patient_id' })
  patientId: string;

  // Sin unique: la disponibilidad real la controla DoctorSlot.status;
  // una cita cancelada/rechazada no debe impedir que el mismo slot se reserve de nuevo.
  @Column({ name: 'slot_id' })
  slotId: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: AppointmentStatus,
    default: AppointmentStatus.PENDING,
  })
  status: AppointmentStatus;

  @Column({ name: 'reason', nullable: true })
  reason: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Doctor)
  @JoinColumn({ name: 'doctor_id' })
  doctor: Doctor;

  @ManyToOne(() => Patient)
  @JoinColumn({ name: 'patient_id' })
  patient: Patient;

  // ManyToOne (no OneToOne): un slot puede tener varias citas a lo largo del tiempo
  // (canceladas/rechazadas incluidas); TypeORM forzaría un UNIQUE en slot_id con OneToOne.
  @ManyToOne(() => DoctorSlot)
  @JoinColumn({ name: 'slot_id' })
  slot: DoctorSlot;
}
