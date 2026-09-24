import { Module } from '@nestjs/common';

import { TypeOrmModule } from '@nestjs/typeorm';

import { EmployeesController } from './employees.controller.js';

import { EmployeesService } from './employees.service.js';

import { Employee } from './entities/employee.entity.js';

import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([Employee]), AuthModule],

  controllers: [EmployeesController],

  providers: [EmployeesService],

  exports: [EmployeesService],
})
export class EmployeesModule {}
