import { EntityManager, In } from 'typeorm';

import { Customer } from './entities/customer.entity.js';
import { CustomerPrice } from './entities/customer-price.entity.js';
import { PriceList } from '../price-lists/entities/price-list.entity.js';
import { PriceListItem } from '../price-lists/entities/price-list-item.entity.js';

const money = (value: number) => Math.round(value * 100) / 100;

type PricedProduct = { id: string; salePrice: number | string };

export type ListRule = {
  adjustmentPercent: number;
  // Precio fijo del producto en la lista, si tiene.
  itemPrice?: number;
};

export type SpecialRule = {
  price: number | null;
  discountPercent: number | null;
};

// Precio de la lista: el fijo del producto si tiene, si no el normal con el
// ajuste de la lista. Sin lista, el normal.
export function listPriceOf(salePrice: number, list?: ListRule | null) {
  if (!list) return salePrice;
  if (list.itemPrice !== undefined) return list.itemPrice;
  return money(salePrice * (1 + list.adjustmentPercent / 100));
}

// Precio final: primero la lista y después el descuento adicional del
// cliente en ese producto. Un precio especial fijo reemplaza a todo.
export function resolvePrice(
  salePrice: number,
  list?: ListRule | null,
  special?: SpecialRule | null,
) {
  if (special?.price !== null && special?.price !== undefined) {
    return Number(special.price);
  }

  const base = listPriceOf(salePrice, list);

  if (special?.discountPercent) {
    return money(base * (1 - Number(special.discountPercent) / 100));
  }

  return base;
}

export type CustomerPricing = {
  priceListId: string | null;
  listPrice(product: PricedProduct): number;
  priceOf(product: PricedProduct): number;
  // true si el cliente tiene un precio especial o descuento en el producto.
  hasSpecial(productId: string): boolean;
};

const DEFAULT_PRICING: CustomerPricing = {
  priceListId: null,
  listPrice: (product) => Number(product.salePrice),
  priceOf: (product) => Number(product.salePrice),
  hasSpecial: () => false,
};

// Cómo se le cobra a cada cliente (lista + precios especiales), en pocas
// consultas. Con productIds solo se consideran esos productos.
export async function pricingFor(
  manager: EntityManager,
  customerIds: string[],
  productIds?: string[],
) {
  const ids = [...new Set(customerIds)];
  const result = new Map<string, CustomerPricing>();

  if (!ids.length || (productIds && !productIds.length)) {
    ids.forEach((id) => result.set(id, DEFAULT_PRICING));
    return result;
  }

  const productFilter = productIds
    ? { productId: In([...new Set(productIds)]) }
    : {};

  const customers = await manager.getRepository(Customer).find({
    select: { id: true, priceListId: true },
    where: { id: In(ids) },
  });

  const listIds = [
    ...new Set(
      customers
        .map((customer) => customer.priceListId)
        .filter((id): id is string => !!id),
    ),
  ];

  const [lists, listItems, specials] = await Promise.all([
    listIds.length
      ? manager
          .getRepository(PriceList)
          .findBy({ id: In(listIds), isActive: true })
      : [],
    listIds.length
      ? manager
          .getRepository(PriceListItem)
          .findBy({ priceListId: In(listIds), ...productFilter })
      : [],
    manager
      .getRepository(CustomerPrice)
      .findBy({ customerId: In(ids), ...productFilter }),
  ]);

  const listById = new Map(lists.map((list) => [list.id, list]));
  const itemPrices = new Map(
    listItems.map((item) => [
      `${item.priceListId}:${item.productId}`,
      Number(item.price),
    ]),
  );
  const specialsByKey = new Map(
    specials.map((special) => [
      `${special.customerId}:${special.productId}`,
      special,
    ]),
  );

  for (const id of ids) {
    const customer = customers.find((c) => c.id === id);
    const list = customer?.priceListId
      ? listById.get(customer.priceListId)
      : undefined;

    const listRule = (productId: string): ListRule | null =>
      list
        ? {
            adjustmentPercent: Number(list.adjustmentPercent),
            itemPrice: itemPrices.get(`${list.id}:${productId}`),
          }
        : null;

    const specialRule = (productId: string): SpecialRule | null => {
      const special = specialsByKey.get(`${id}:${productId}`);
      return special
        ? {
            price: special.price === null ? null : Number(special.price),
            discountPercent:
              special.discountPercent === null
                ? null
                : Number(special.discountPercent),
          }
        : null;
    };

    result.set(id, {
      priceListId: list?.id ?? null,
      listPrice: (product) =>
        listPriceOf(Number(product.salePrice), listRule(product.id)),
      priceOf: (product) =>
        resolvePrice(
          Number(product.salePrice),
          listRule(product.id),
          specialRule(product.id),
        ),
      hasSpecial: (productId) => specialsByKey.has(`${id}:${productId}`),
    });
  }

  return result;
}

export async function pricingForCustomer(
  manager: EntityManager,
  customerId: string,
  productIds?: string[],
) {
  return (
    (await pricingFor(manager, [customerId], productIds)).get(customerId) ??
    DEFAULT_PRICING
  );
}
