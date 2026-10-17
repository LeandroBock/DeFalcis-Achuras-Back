import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';

import { PriceList } from './entities/price-list.entity.js';
import { PriceListItem } from './entities/price-list-item.entity.js';
import { Customer } from '../customers/entities/customer.entity.js';
import { Product } from '../products/entities/product.entity.js';
import { listPriceOf } from '../customers/customer-prices.js';
import {
  CreatePriceListDto,
  UpdatePriceListDto,
} from './dto/price-list.dto.js';

@Injectable()
export class PriceListsService {
  constructor(
    @InjectRepository(PriceList)
    private readonly listsRepository: Repository<PriceList>,

    @InjectRepository(PriceListItem)
    private readonly itemsRepository: Repository<PriceListItem>,

    @InjectRepository(Customer)
    private readonly customersRepository: Repository<Customer>,

    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,

    private readonly dataSource: DataSource,
  ) {}

  // Listas activas con cuántos clientes y precios fijos tiene cada una.
  async findAll() {
    const lists = await this.listsRepository.find({
      where: { isActive: true },
      order: { name: 'ASC' },
    });

    if (!lists.length) return [];

    const ids = lists.map((list) => list.id);
    const [customers, items]: [
      { priceListId: string; count: string }[],
      { priceListId: string; count: string }[],
    ] = await Promise.all([
      this.customersRepository
        .createQueryBuilder('c')
        .select('c.priceListId', 'priceListId')
        .addSelect('COUNT(*)', 'count')
        .where('c.priceListId IN (:...ids)', { ids })
        .andWhere('c.isActive = true')
        .groupBy('c.priceListId')
        .getRawMany(),
      this.itemsRepository
        .createQueryBuilder('i')
        .select('i.priceListId', 'priceListId')
        .addSelect('COUNT(*)', 'count')
        .where('i.priceListId IN (:...ids)', { ids })
        .groupBy('i.priceListId')
        .getRawMany(),
    ]);

    const count = (
      rows: { priceListId: string; count: string }[],
      id: string,
    ) => Number(rows.find((row) => row.priceListId === id)?.count ?? 0);

    return lists.map((list) => ({
      ...this.serialize(list),
      customerCount: count(customers, list.id),
      itemCount: count(items, list.id),
    }));
  }

  // La lista con el precio de cada producto activo (fijo o por el ajuste) y
  // los clientes que la usan.
  async findOne(id: string) {
    const list = await this.findActive(id);

    const [items, products, customers] = await Promise.all([
      this.itemsRepository.findBy({ priceListId: id }),
      this.productsRepository.find({
        where: { isActive: true },
        order: { name: 'ASC' },
      }),
      this.customersRepository.find({
        select: { id: true, name: true },
        where: { priceListId: id, isActive: true },
        order: { name: 'ASC' },
      }),
    ]);

    const itemPrice = new Map(
      items.map((item) => [item.productId, Number(item.price)]),
    );
    const adjustmentPercent = Number(list.adjustmentPercent);

    return {
      ...this.serialize(list),
      customers,
      products: products.map((product) => ({
        productId: product.id,
        productName: product.name,
        unit: product.unit,
        normalPrice: Number(product.salePrice),
        fixedPrice: itemPrice.get(product.id) ?? null,
        price: listPriceOf(Number(product.salePrice), {
          adjustmentPercent,
          itemPrice: itemPrice.get(product.id),
        }),
      })),
    };
  }

  async create(dto: CreatePriceListDto) {
    const list = await this.listsRepository.save(
      this.listsRepository.create({
        name: dto.name.trim(),
        adjustmentPercent: dto.adjustmentPercent ?? 0,
      }),
    );

    return this.serialize(list);
  }

  async update(id: string, dto: UpdatePriceListDto) {
    const list = await this.findActive(id);

    if (dto.name !== undefined) list.name = dto.name.trim();
    if (dto.adjustmentPercent !== undefined) {
      list.adjustmentPercent = dto.adjustmentPercent;
    }

    return this.serialize(await this.listsRepository.save(list));
  }

  // Los clientes de la lista pasan a pagar el precio normal.
  async deactivate(id: string) {
    const list = await this.findActive(id);

    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(Customer)
        .update({ priceListId: id }, { priceListId: null });
      list.isActive = false;
      await manager.getRepository(PriceList).save(list);
    });

    return { message: 'Lista de precios desactivada' };
  }

  async setItemPrice(id: string, productId: string, price: number) {
    await this.findActive(id);

    const product = await this.productsRepository.findOneBy({
      id: productId,
      isActive: true,
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado o inactivo');
    }

    await this.itemsRepository.upsert({ priceListId: id, productId, price }, [
      'priceListId',
      'productId',
    ]);

    return { productId, price };
  }

  // Sin precio fijo, el producto vuelve a calcularse con el ajuste de la lista.
  async removeItemPrice(id: string, productId: string) {
    const result = await this.itemsRepository.delete({
      priceListId: id,
      productId,
    });

    if (!result.affected) {
      throw new NotFoundException(
        'La lista no tiene precio fijo para ese producto',
      );
    }

    return { message: 'Precio fijo quitado' };
  }

  async setCustomers(id: string, customerIds: string[]) {
    await this.findActive(id);

    const uniqueIds = [...new Set(customerIds)];

    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Customer);

      if (uniqueIds.length) {
        const found = await repository.countBy({ id: In(uniqueIds) });
        if (found !== uniqueIds.length) {
          throw new NotFoundException('Alguno de los clientes no existe');
        }
      }

      await repository.update(
        uniqueIds.length
          ? { priceListId: id, id: Not(In(uniqueIds)) }
          : { priceListId: id },
        { priceListId: null },
      );

      if (uniqueIds.length) {
        await repository.update({ id: In(uniqueIds) }, { priceListId: id });
      }
    });

    return this.findOne(id);
  }

  async findActive(id: string) {
    const list = await this.listsRepository.findOneBy({ id, isActive: true });

    if (!list) {
      throw new NotFoundException('Lista de precios no encontrada');
    }

    return list;
  }

  private serialize(list: PriceList) {
    return {
      id: list.id,
      name: list.name,
      adjustmentPercent: Number(list.adjustmentPercent),
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
    };
  }
}
