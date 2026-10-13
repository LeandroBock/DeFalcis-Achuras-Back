import { EntityManager } from 'typeorm';

import {
  SupplierPayment,
  SupplierPaymentMethod,
} from './entities/supplier-payment.entity.js';

import {
  Purchase,
  PurchasePaymentStatus,
} from '../purchases/entities/purchase.entity.js';

// Lo pagado de una compra es siempre la suma de sus pagos (incluye los
// reintegros negativos que pasaron a saldo a favor).
export async function getPurchasePaidAmount(
  manager: EntityManager,
  purchaseId: string,
) {
  const { paid } = await manager
    .getRepository(SupplierPayment)
    .createQueryBuilder('payment')
    .select('COALESCE(SUM(payment.amount), 0)', 'paid')
    .where('payment.purchaseId = :purchaseId', { purchaseId })
    .getRawOne();

  return Number(Number(paid).toFixed(2));
}

export function resolvePurchasePaymentStatus(total: number, paid: number) {
  if (paid >= total) {
    return PurchasePaymentStatus.PAID;
  }

  if (paid > 0) {
    return PurchasePaymentStatus.PARTIAL;
  }

  return PurchasePaymentStatus.PENDING;
}

// Pasa a saldo a favor del proveedor lo pagado por encima de `targetPaid`,
// registrando un reintegro negativo en la compra. Devuelve lo pagado final.
export async function moveExcessToSupplierCredit(
  manager: EntityManager,
  purchase: Purchase,
  paid: number,
  targetPaid: number,
  notes: string,
) {
  const excess = Number((paid - targetPaid).toFixed(2));

  if (excess <= 0) {
    return paid;
  }

  const paymentRepository = manager.getRepository(SupplierPayment);

  await paymentRepository.save(
    paymentRepository.create({
      purchaseId: purchase.id,
      amount: -excess,
      method: SupplierPaymentMethod.SUPPLIER_CREDIT,
      notes,
    }),
  );

  return targetPaid;
}

// Saldo a favor disponible: lo generado (reintegros negativos) menos lo ya
// usado para pagar otras compras del mismo proveedor.
export async function getSupplierCreditBalance(
  manager: EntityManager,
  supplierId: string,
) {
  const { balance } = await manager
    .getRepository(SupplierPayment)
    .createQueryBuilder('payment')
    .innerJoin(Purchase, 'purchase', 'purchase.id = payment.purchaseId')
    .select('COALESCE(-SUM(payment.amount), 0)', 'balance')
    .where('purchase.supplierId = :supplierId', { supplierId })
    .andWhere('payment.method = :method', {
      method: SupplierPaymentMethod.SUPPLIER_CREDIT,
    })
    .getRawOne();

  return Number(Number(balance).toFixed(2));
}
