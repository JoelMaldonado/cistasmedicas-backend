import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserRoleName } from 'src/common/enums/role.enum';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Patient } from '../patients/entities/patient.entity';
import { UserRole } from '../users/entities/user-role.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async register(registerDto: RegisterDto) {
    const user = await this.dataSource.transaction(async (manager) => {
      const existingUser = await manager.findOne(User, {
        where: { email: registerDto.email },
      });

      if (existingUser) {
        throw new UnauthorizedException('El correo ya está registrado');
      }

      const role = await manager.findOne(UserRole, {
        where: { name: UserRoleName.PATIENT },
      });

      if (!role) {
        throw new UnauthorizedException('Rol de paciente no configurado');
      }

      const hashedPassword = await bcrypt.hash(registerDto.password, 10);

      const newUser = manager.create(User, {
        email: registerDto.email,
        password: hashedPassword,
        fullName: registerDto.fullName,
        role,
      });

      const savedUser = await manager.save(newUser);

      const newPatient = manager.create(Patient, {
        userId: savedUser.id,
      });

      await manager.save(newPatient);

      return savedUser;
    });

    return this.buildAuthResponse(user);
  }

  async login(loginDto: LoginDto) {
    const user = await this.usersService.findByEmail(loginDto.email);

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Usuario inactivo');
    }

    return this.buildAuthResponse(user);
  }

  private buildAuthResponse(user: {
    id: string;
    email: string;
    fullName: string;
    role: { name: string } | null;
  }) {
    if (!user.role) {
      // Puede pasar con datos sembrados/editados a mano sin asignar rol.
      throw new UnauthorizedException(
        'El usuario no tiene un rol asignado. Contacta al administrador.',
      );
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role.name,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role.name,
      },
    };
  }
}
