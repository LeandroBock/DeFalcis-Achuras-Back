import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { Employee } from './entities/employee.entity.js';

import { CreateEmployeeDto } from './dto/create-employee.dto.js';

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Employee)
    private readonly employeesRepository: Repository<Employee>,
  ) {}

  async create(createEmployeeDto: CreateEmployeeDto) {
    const employee = this.employeesRepository.create(createEmployeeDto);

    return this.employeesRepository.save(employee);
  }

  async findAll() {
    return this.employeesRepository.find({
      where: {
        isActive: true,
      },
      order: {
        name: 'ASC',
      },
    });
  }

  async findOne(id: string) {
    const employee = await this.employeesRepository.findOne({
      where: {
        id,
        isActive: true,
      },
    });

    if (!employee) {
      throw new NotFoundException('Empleado no encontrado');
    }

    return employee;
  }

  async update(id: string, updateData: Partial<CreateEmployeeDto>) {
    const employee = await this.findOne(id);

    Object.assign(employee, updateData);

    return this.employeesRepository.save(employee);
  }

  async deactivate(id: string) {
    const employee = await this.findOne(id);

    employee.isActive = false;

    await this.employeesRepository.save(employee);

    return {
      message: 'Empleado desactivado correctamente',
    };
  }
}
