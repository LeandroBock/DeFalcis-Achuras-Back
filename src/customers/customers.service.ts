import { Injectable, NotFoundException } from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { Customer } from './entities/customer.entity.js';
import { CustomerPrice } from './entities/customer-price.entity.js';
import { Product } from '../products/entities/product.entity.js';

import { CreateCustomerDto } from './dto/create-customer.dto.js';

import { UpdateCustomerDto } from './dto/update-customer.dto.js';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customersRepository: Repository<Customer>,

    @InjectRepository(CustomerPrice)
    private readonly pricesRepository: Repository<CustomerPrice>,

    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
  ) {}

  // ---------- Precios especiales ----------

  // Precios especiales del cliente, con el precio normal al lado para ver la
  // diferencia (y darse cuenta si quedó desactualizado tras un aumento).
  async findPrices(customerId: string) {
    await this.findOne(customerId);

    const prices = await this.pricesRepository.find({ where: { customerId } });
    const products = prices.length
      ? await this.productsRepository.findBy(
          prices.map((price) => ({ id: price.productId })),
        )
      : [];
    const productById = new Map(products.map((p) => [p.id, p]));

    return prices
      .map((price) => {
        const product = productById.get(price.productId);
        return {
          productId: price.productId,
          productName: product?.name ?? 'Producto eliminado',
          unit: product?.unit ?? 'kg',
          normalPrice: Number(product?.salePrice ?? 0),
          price: Number(price.price),
          updatedAt: price.updatedAt,
        };
      })
      .sort((a, b) => a.productName.localeCompare(b.productName));
  }

  async setPrice(customerId: string, productId: string, price: number) {
    await this.findOne(customerId);

    const product = await this.productsRepository.findOneBy({
      id: productId,
      isActive: true,
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado o inactivo');
    }

    await this.pricesRepository.upsert({ customerId, productId, price }, [
      'customerId',
      'productId',
    ]);

    return {
      productId,
      productName: product.name,
      unit: product.unit,
      normalPrice: Number(product.salePrice),
      price,
    };
  }

  async removePrice(customerId: string, productId: string) {
    const result = await this.pricesRepository.delete({
      customerId,
      productId,
    });

    if (!result.affected) {
      throw new NotFoundException(
        'El cliente no tiene precio especial para ese producto',
      );
    }

    return { message: 'Precio especial eliminado' };
  }

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
