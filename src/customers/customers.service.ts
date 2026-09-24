import { Injectable, NotFoundException } from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { Customer } from './entities/customer.entity.js';

import { CreateCustomerDto } from './dto/create-customer.dto.js';

import { UpdateCustomerDto } from './dto/update-customer.dto.js';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customersRepository: Repository<Customer>,
  ) {}

  async create(createCustomerDto: CreateCustomerDto) {
    const customer = this.customersRepository.create(createCustomerDto);

    return this.customersRepository.save(customer);
  }

  async findAll() {
    return this.customersRepository.find({
      where: {
        isActive: true,
      },
      order: {
        name: 'ASC',
      },
    });
  }

  async findOne(id: string) {
    const customer = await this.customersRepository.findOne({
      where: {
        id,
        isActive: true,
      },
    });

    if (!customer) {
      throw new NotFoundException('Cliente no encontrado');
    }

    return customer;
  }

  async update(id: string, updateCustomerDto: UpdateCustomerDto) {
    const customer = await this.customersRepository.findOne({
      where: {
        id,
        isActive: true,
      },
    });

    if (!customer) {
      throw new NotFoundException('Cliente no encontrado');
    }

    Object.assign(customer, updateCustomerDto);

    return this.customersRepository.save(customer);
  }

  async deactivate(id: string) {
    const customer = await this.customersRepository.findOne({
      where: {
        id,
        isActive: true,
      },
    });

    if (!customer) {
      throw new NotFoundException('Cliente no encontrado');
    }

    customer.isActive = false;

    return this.customersRepository.save(customer);
  }
}
