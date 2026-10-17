import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { Customer } from './entities/customer.entity.js';
import { CustomerPrice } from './entities/customer-price.entity.js';
import { Product } from '../products/entities/product.entity.js';
import { PriceList } from '../price-lists/entities/price-list.entity.js';
import { pricingForCustomer } from './customer-prices.js';
import { SetCustomerPriceDto } from './dto/set-customer-price.dto.js';

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

  // Precios especiales del cliente, con el precio normal y el de su lista al
  // lado para ver la diferencia (y darse cuenta si quedó desactualizado).
  async findPrices(customerId: string) {
    await this.findOne(customerId);

    const prices = await this.pricesRepository.find({ where: { customerId } });
    const products = prices.length
      ? await this.productsRepository.findBy({
          id: In(prices.map((price) => price.productId)),
        })
      : [];
    const productById = new Map(products.map((p) => [p.id, p]));
    const pricing = await pricingForCustomer(
      this.customersRepository.manager,
      customerId,
      prices.map((price) => price.productId),
    );

    return prices
      .map((price) => {
        const product = productById.get(price.productId);
        const priced = {
          id: price.productId,
          salePrice: product?.salePrice ?? 0,
        };
        return {
          productId: price.productId,
          productName: product?.name ?? 'Producto eliminado',
          unit: product?.unit ?? 'kg',
          normalPrice: Number(product?.salePrice ?? 0),
          listPrice: pricing.listPrice(priced),
          fixedPrice: price.price === null ? null : Number(price.price),
          discountPercent:
            price.discountPercent === null
              ? null
              : Number(price.discountPercent),
          // Lo que paga al final.
          price: pricing.priceOf(priced),
          updatedAt: price.updatedAt,
        };
      })
      .sort((a, b) => a.productName.localeCompare(b.productName));
  }

  // Lo que paga el cliente por cada producto activo (lista + descuentos),
  // para armar la nota de pedido con los precios correctos.
  async findPricing(customerId: string) {
    const customer = await this.findOne(customerId);
    const manager = this.customersRepository.manager;

    const [products, pricing, list] = await Promise.all([
      this.productsRepository.find({
        select: { id: true, salePrice: true },
        where: { isActive: true },
      }),
      pricingForCustomer(manager, customerId),
      customer.priceListId
        ? manager
            .getRepository(PriceList)
            .findOneBy({ id: customer.priceListId, isActive: true })
        : null,
    ]);

    return {
      priceList: list ? { id: list.id, name: list.name } : null,
      collectDebt: customer.collectDebt,
      prices: Object.fromEntries(
        products.map((product) => [
          product.id,
          {
            price: pricing.priceOf(product),
            special: pricing.hasSpecial(product.id),
          },
        ]),
      ),
    };
  }

  async setPrice(
    customerId: string,
    productId: string,
    dto: SetCustomerPriceDto,
  ) {
    await this.findOne(customerId);

    const hasPrice = dto.price !== undefined && dto.price !== null;
    const hasDiscount =
      dto.discountPercent !== undefined && dto.discountPercent !== null;

    if (hasPrice === hasDiscount) {
      throw new BadRequestException(
        'Indicá un precio fijo o un porcentaje de descuento (uno de los dos)',
      );
    }

    const product = await this.productsRepository.findOneBy({
      id: productId,
      isActive: true,
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado o inactivo');
    }

    await this.pricesRepository.upsert(
      {
        customerId,
        productId,
        price: hasPrice ? dto.price : null,
        discountPercent: hasDiscount ? dto.discountPercent : null,
      },
      ['customerId', 'productId'],
    );

    return (await this.findPrices(customerId)).find(
      (price) => price.productId === productId,
    );
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

  private async assertPriceList(priceListId?: string | null) {
    if (!priceListId) return;

    const exists = await this.customersRepository.manager
      .getRepository(PriceList)
      .existsBy({ id: priceListId, isActive: true });

    if (!exists) {
      throw new NotFoundException('Lista de precios no encontrada');
    }
  }

  async create(createCustomerDto: CreateCustomerDto) {
    await this.assertPriceList(createCustomerDto.priceListId);

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

    await this.assertPriceList(updateCustomerDto.priceListId);

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
