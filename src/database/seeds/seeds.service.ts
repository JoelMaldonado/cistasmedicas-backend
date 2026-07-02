import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { UserRole } from 'src/modules/users/entities/user-role.entity';
import { User } from 'src/modules/users/entities/user.entity';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

@Injectable()
export class SeedsService {
  constructor(
    @InjectRepository(UserRole)
    private readonly roleRepository: Repository<UserRole>,

    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    private readonly configService: ConfigService,
  ) {}

  async seed() {
    await this.seedUserRoles();
    await this.seedUsers();
  }

  private async seedUserRoles() {
    await this.roleRepository.upsert(
      [
        { name: 'admin', description: 'Administrator' },
        { name: 'doctor', description: 'Medical Doctor' },
        { name: 'patient', description: 'Patient' },
      ],
      ['name'],
    );
  }

  private async seedUsers() {
    const adminRole = await this.roleRepository.findOneByOrFail({
      name: 'admin',
    });

    const email = this.configService.getOrThrow<string>('ADMIN_EMAIL');
    const password = this.configService.getOrThrow<string>('ADMIN_PASSWORD');
    const hashedPassword = await bcrypt.hash(password, 10);

    await this.userRepository.upsert(
      [
        {
          email,
          password: hashedPassword,
          fullName: 'Joel Maldonado',
          role: { id: adminRole.id },
        },
      ],
      ['email'],
    );
  }
}
