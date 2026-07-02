import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AppointmentsService } from './appointments.service';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRoleName } from 'src/common/enums/role.enum';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { User } from '../users/entities/user.entity';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';

interface AuthenticatedRequest extends Request {
  user: User;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get('doctors/:doctorId/available-slots')
  getAvailableSlots(@Param('doctorId') doctorId: string) {
    return this.appointmentsService.getAvailableSlots(doctorId);
  }

  @Post('appointments')
  @UseGuards(RolesGuard)
  @Roles(UserRoleName.PATIENT)
  createAppointment(
    @Req() req: AuthenticatedRequest,
    @Body() createAppointmentDto: CreateAppointmentDto,
  ) {
    return this.appointmentsService.createAppointment(
      req.user.id,
      createAppointmentDto,
    );
  }

  @Patch('appointments/:id/confirm')
  @UseGuards(RolesGuard)
  @Roles(UserRoleName.DOCTOR)
  confirmAppointment(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.appointmentsService.respondToAppointment(
      req.user.id,
      id,
      'confirmed',
    );
  }

  @Patch('appointments/:id/reject')
  @UseGuards(RolesGuard)
  @Roles(UserRoleName.DOCTOR)
  rejectAppointment(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.appointmentsService.respondToAppointment(
      req.user.id,
      id,
      'rejected',
    );
  }

  @Patch('appointments/:id/reschedule')
  @UseGuards(RolesGuard)
  @Roles(UserRoleName.DOCTOR)
  rescheduleAppointment(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() rescheduleAppointmentDto: RescheduleAppointmentDto,
  ) {
    return this.appointmentsService.rescheduleAppointment(
      req.user.id,
      id,
      rescheduleAppointmentDto.newSlotId,
    );
  }

  @Delete('appointments/:id')
  cancelAppointment(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.appointmentsService.cancelAppointment(req.user.id, id);
  }

  @Get('appointments/my-appointments')
  findMyAppointments(@Req() req: AuthenticatedRequest) {
    return this.appointmentsService.findMyAppointments(
      req.user.id,
      req.user.role?.name as UserRoleName,
    );
  }
}
