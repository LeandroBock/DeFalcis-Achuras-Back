import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UpdateSupplierDto } from './dto/update-supplier.dto.js';
import { Supplier } from './entities/supplier.entity.js';
import { CreateSupplierDto } from './dto/create-supplier.dto.js';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier)
    private readonly suppliersRepository: Repository<Supplier>,
  ) {}

  async create(createSupplierDto: CreateSupplierDto): Promise<Supplier> {
    const existingSupplier = await this.suppliersRepository.findOne({
      where: {
        name: createSupplierDto.name,
      },
    });

    if (existingSupplier) {
      throw new ConflictException('El proveedor ya existe');
    }

    if (createSupplierDto.email) {
      const existingEmail = await this.suppliersRepository.findOne({
        where: { email: createSupplierDto.email },
      });

      if (existingEmail) {
        throw new ConflictException(
          'El correo electrónico ya está registrado por otro proveedor',
        );
      }
    }
      if (createSupplierDto.phone) {
        const existingPhone = await this.suppliersRepository.findOne({
          where: { phone: createSupplierDto.phone },
        });

        if (existingPhone) {
          throw new ConflictException(
            'El correo electrónico ya está registrado por otro proveedor',
          );
        }
      }
      const supplier = this.suppliersRepository.create(createSupplierDto);

      return this.suppliersRepository.save(supplier);
    }
  

  async update(
    id: string,
    updateSupplierDto: UpdateSupplierDto,
  ): Promise<Supplier> {
    const supplier = await this.findOne(id);

    if (updateSupplierDto.name && updateSupplierDto.name !== supplier.name) {
      const existingSupplier = await this.suppliersRepository.findOne({
        where: {
          name: updateSupplierDto.name,
        },
      });

      if (existingSupplier && existingSupplier.id !== id) {
        throw new ConflictException('El proveedor ya existe');
      }
    }

    Object.assign(supplier, updateSupplierDto);

    return this.suppliersRepository.save(supplier);
  }

  async findAll(): Promise<Supplier[]> {
    return this.suppliersRepository.find({
      where: {
        isActive: true,
      },
      order: {
        name: 'ASC',
      },
    });
  }

  async findOne(id: string): Promise<Supplier> {
    const supplier = await this.suppliersRepository.findOne({
      where: { id },
    });

    if (!supplier) {
      throw new NotFoundException('Proveedor no encontrado');
    }

    return supplier;
  }

  async deactivate(id: string): Promise<Supplier> {
    const supplier = await this.findOne(id);

    supplier.isActive = false;

    return this.suppliersRepository.save(supplier);
  }
}
