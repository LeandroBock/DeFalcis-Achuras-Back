import { NotFoundException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';

import { Product } from './entities/product.entity.js';

// Trae en una sola consulta los productos activos de una lista de ítems.
// Falla si alguno no existe o está inactivo.
export async function findActiveProductsById(
  manager: EntityManager,
  productIds: string[],
) {
  const uniqueIds = [...new Set(productIds)];

  const products = await manager.getRepository(Product).findBy({
    id: In(uniqueIds),
    isActive: true,
  });

  const productsById = new Map(
    products.map((product) => [product.id, product]),
  );

  for (const id of uniqueIds) {
    if (!productsById.has(id)) {
      throw new NotFoundException(
        `El producto ${id} no existe o está inactivo`,
      );
    }
  }

  return productsById;
}
