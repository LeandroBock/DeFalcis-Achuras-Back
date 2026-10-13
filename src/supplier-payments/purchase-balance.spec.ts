import { PurchasePaymentStatus } from '../purchases/entities/purchase.entity.js';

import { resolvePurchasePaymentStatus } from './purchase-balance.js';

describe('resolvePurchasePaymentStatus', () => {
  it.each([
    [5000, 0, PurchasePaymentStatus.PENDING],
    [5000, 0.01, PurchasePaymentStatus.PARTIAL],
    [5000, 4999.99, PurchasePaymentStatus.PARTIAL],
    [5000, 5000, PurchasePaymentStatus.PAID],
    // Sobrepagada (el excedente se pasa a saldo a favor por separado).
    [5000, 6000, PurchasePaymentStatus.PAID],
    // Una compra en $0 no se le debe nada al proveedor.
    [0, 0, PurchasePaymentStatus.PAID],
  ])('total %d, pagado %d → %s', (total, paid, expected) => {
    expect(resolvePurchasePaymentStatus(total, paid)).toBe(expected);
  });
});
