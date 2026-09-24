import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

import { EmployeePosition } from '../entities/employee.entity.js';

export class CreateEmployeeDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsEnum(EmployeePosition)
  position: EmployeePosition;

  @IsNumber()
  @Min(0)
  salary: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
