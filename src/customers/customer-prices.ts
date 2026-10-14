import { EntityManager, In } from 'typeorm';

import { CustomerPrice } from './entities/customer-price.entity.js';

// Precios especiales de un cliente: productId → precio. Los productos que no
// están en el mapa se cobran al precio normal.
export async function specialPricesFor(
  manager: EntityManager,
  customerId: string,
  productIds?: string[],
) {
  const prices = await manager.getRepository(CustomerPrice).find({
    where: {
      customerId,
      ...(productIds ? { productId: In([...new Set(productIds)]) } : {}),
    },
  });

  return new Map(prices.map((price) => [price.productId, Number(price.price)]));
}

// Precio a cobrarle al cliente: el especial si tiene, si no el normal.
export const priceFor = (
  specialPrices: Map<string, number>,
  product: { id: string; salePrice: number | string },
) => specialPrices.get(product.id) ?? Number(product.salePrice);
