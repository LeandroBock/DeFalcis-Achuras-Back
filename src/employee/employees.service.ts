import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, In, Repository } from 'typeorm';

import { User } from '../users/entities/user.entity.js';
import { BCRYPT_ROUNDS } from '../users/users.service.js';

import { Employee } from './entities/employee.entity.js';
import { CreateEmployeeDto } from './dto/create-employee.dto.js';
import { UpdateEmployeeDto } from './dto/update-employee.dto.js';
import {
  CreateEmployeeAccountDto,
  UpdateEmployeeAccountDto,
} from './dto/employee-account.dto.js';

// Datos del acceso a la app de un empleado (nunca la contraseña).
const ACCOUNT_FIELDS = {
  id: true,
  email: true,
  role: true,
  isActive: true,
} as const;

type Account = Pick<User, 'id' | 'email' | 'role' | 'isActive'>;

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Employee)
    private readonly employeesRepository: Repository<Employee>,

    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,

    private readonly dataSource: DataSource,
  ) {}

  async create(createEmployeeDto: CreateEmployeeDto) {
    const employee = this.employeesRepository.create(createEmployeeDto);
    return this.employeesRepository.save(employee);
  }

  async findAll() {
    const employees = await this.employeesRepository.find({
      where: {
        isActive: true,
      },
      order: {
        name: 'ASC',
      },
    });

    return this.withAccounts(employees);
  }

  async findOne(id: string) {
    const [employee] = await this.withAccounts([await this.findActive(id)]);
    return employee;
  }

  async update(id: string, updateData: UpdateEmployeeDto) {
    const employee = await this.findActive(id);

    Object.assign(employee, updateData);

    return this.dataSource.transaction(async (manager) => {
      const saved = await manager.getRepository(Employee).save(employee);

      // El nombre del usuario es el que se ve en la app (rendición, reparto).
      if (updateData.name && employee.userId) {
        await manager
          .getRepository(User)
          .update(employee.userId, { name: updateData.name });
      }

      return saved;
    });
  }

  async deactivate(id: string) {
    const employee = await this.findActive(id);

    await this.dataSource.transaction(async (manager) => {
      employee.isActive = false;
      await manager.getRepository(Employee).save(employee);

      // Sin empleo no hay acceso: se corta al instante (el guard de JWT
      // verifica que el usuario siga activo en cada request).
      if (employee.userId) {
        await manager
          .getRepository(User)
          .update(employee.userId, { isActive: false });
      }
    });

    return {
      message: 'Empleado desactivado correctamente',
    };
  }

  // Crea el usuario con el que el empleado entra a la app.
  async createAccount(id: string, dto: CreateEmployeeAccountDto) {
    return this.dataSource.transaction(async (manager) => {
      const employee = await manager.getRepository(Employee).findOne({
        where: { id, isActive: true },
        lock: { mode: 'pessimistic_write' },
      });

      if (!employee) {
        throw new NotFoundException('Empleado no encontrado');
      }

      if (employee.userId) {
        throw new ConflictException('El empleado ya tiene acceso a la app');
      }

      const userRepository = manager.getRepository(User);
      const user = await userRepository.save(
        userRepository.create({
          name: employee.name,
          email: dto.email.trim().toLowerCase(),
          password: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
          role: dto.role,
          isActive: true,
        }),
      );

      employee.userId = user.id;
      await manager.getRepository(Employee).save(employee);

      return this.toAccount(user);
    });
  }

  // Cambiar el rol, resetear la contraseña o bloquear/desbloquear el acceso.
  async updateAccount(id: string, dto: UpdateEmployeeAccountDto) {
    const employee = await this.findActive(id);

    if (!employee.userId) {
      throw new NotFoundException('El empleado no tiene acceso a la app');
    }

    const changes: Partial<User> = {};
    if (dto.role !== undefined) changes.role = dto.role;
    if (dto.isActive !== undefined) changes.isActive = dto.isActive;
    if (dto.password !== undefined) {
      changes.password = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    }

    if (Object.keys(changes).length) {
      await this.usersRepository.update(employee.userId, changes);
    }

    return this.toAccount(
      await this.usersRepository.findOneOrFail({
        select: ACCOUNT_FIELDS,
        where: { id: employee.userId },
      }),
    );
  }

  private async findActive(id: string) {
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

  private async withAccounts(employees: Employee[]) {
    const userIds = employees
      .map((employee) => employee.userId)
      .filter((userId): userId is string => !!userId);

    const users = userIds.length
      ? await this.usersRepository.find({
          select: ACCOUNT_FIELDS,
          where: { id: In(userIds) },
        })
      : [];
    const userById = new Map(users.map((user) => [user.id, user]));

    return employees.map((employee) => {
      const user = employee.userId ? userById.get(employee.userId) : undefined;
      return {
        id: employee.id,
        name: employee.name,
        phone: employee.phone,
        email: employee.email,
        position: employee.position,
        salary: employee.salary,
        isActive: employee.isActive,
        notes: employee.notes,
        createdAt: employee.createdAt,
        updatedAt: employee.updatedAt,
        account: user ? this.toAccount(user) : null,
      };
    });
  }

  private toAccount(user: Account) {
    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
    };
  }
}
