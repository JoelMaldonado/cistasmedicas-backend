import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreateDoctorDto {
  @IsEmail({}, { message: 'El correo no tiene un formato válido' })
  email: string;

  @IsString()
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  password: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre completo es obligatorio' })
  fullName: string;

  @IsString()
  @IsNotEmpty({ message: 'La especialidad es obligatoria' })
  specialty: string;
}
