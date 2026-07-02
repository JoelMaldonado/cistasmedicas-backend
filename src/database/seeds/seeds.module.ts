import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeedsService } from './seeds.service';
import { UserRole } from 'src/modules/users/entities/user-role.entity';
import { User } from 'src/modules/users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserRole, User])],
  providers: [SeedsService],
})
export class SeedsModule implements OnApplicationBootstrap {
  constructor(private readonly seedsService: SeedsService) {}

  async onApplicationBootstrap() {
    await this.seedsService.seed();
  }
}
