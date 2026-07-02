import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Doctor } from './entities/doctor.entity';
import { DataSource, Repository } from 'typeorm';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { UserRoleName } from 'src/common/enums/role.enum';
import { UserRole } from '../users/entities/user-role.entity';
import { User } from '../users/entities/user.entity';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class DoctorsService {
  constructor(
    @InjectRepository(Doctor)
    private readonly doctorRepository: Repository<Doctor>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async create(createDoctorDto: CreateDoctorDto): Promise<Doctor> {
    return this.dataSource.transaction(async (manager) => {
      const existingUser = await manager.findOne(User, {
        where: { email: createDoctorDto.email },
      });

      if (existingUser) {
        throw new ConflictException('El correo ya está registrado');
      }

      const role = await manager.findOne(UserRole, {
        where: { name: UserRoleName.DOCTOR },
      });

      if (!role) {
        throw new NotFoundException('Rol de médico no configurado');
      }

      const hashedPassword = await bcrypt.hash(createDoctorDto.password, 10);

      const newUser = manager.create(User, {
        email: createDoctorDto.email,
        password: hashedPassword,
        fullName: createDoctorDto.fullName,
        role,
      });

      const savedUser = await manager.save(newUser);

      const newDoctor = manager.create(Doctor, {
        userId: savedUser.id,
        specialty: createDoctorDto.specialty,
      });

      return manager.save(newDoctor);
    });
  }

  async findAll(): Promise<Doctor[]> {
    return this.doctorRepository.find();
  }

  async findOne(id: string): Promise<Doctor> {
    const doctor = await this.doctorRepository.findOne({ where: { id } });

    if (!doctor) {
      throw new NotFoundException(`Médico con id "${id}" no encontrado`);
    }

    return doctor;
  }

  async findByUserId(userId: string): Promise<Doctor | null> {
    return this.doctorRepository.findOne({ where: { userId } });
  }

  async update(id: string, updateDoctorDto: UpdateDoctorDto): Promise<Doctor> {
    const doctor = await this.findOne(id);
    Object.assign(doctor, updateDoctorDto);
    return this.doctorRepository.save(doctor);
  }
}
