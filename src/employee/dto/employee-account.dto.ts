import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

import { UserRole } from '../../users/entities/user.entity.js';

// Roles que se pueden dar desde Empleados. Las cuentas de super admin solo se
// crean desde Usuarios.
export const EMPLOYEE_ROLES = [
  UserRole.ADMIN,
  UserRole.VENTAS,
  UserRole.DEPOSITO,
  UserRole.REPARTO,
  UserRole.FINANZAS,
];

const ROLE_MESSAGE = `El rol tiene que ser uno de: ${EMPLOYEE_ROLES.join(', ')}`;

export class CreateEmployeeAccountDto {
  @IsEmail({}, { message: 'El email no es válido' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  password: string;

  @IsIn(EMPLOYEE_ROLES, { message: ROLE_MESSAGE })
  role: UserRole;
}

export class UpdateEmployeeAccountDto {
  @IsOptional()
  @IsIn(EMPLOYEE_ROLES, { message: ROLE_MESSAGE })
  role?: UserRole;

  // Nueva contraseña (para cuando el empleado se la olvida).
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  password?: string;

  // false para bloquear el acceso sin dar de baja al empleado.
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
