import { listPriceOf, resolvePrice } from './customer-prices.js';

describe('precio de un producto para un cliente', () => {
  it('sin lista ni descuento paga el precio normal', () => {
    expect(resolvePrice(1000)).toBe(1000);
  });

  it('con lista: el precio fijo de la lista, o el normal con el ajuste', () => {
    expect(listPriceOf(1000, { adjustmentPercent: -10, itemPrice: 850 })).toBe(
      850,
    );
    expect(listPriceOf(1000, { adjustmentPercent: -10 })).toBe(900);
    expect(listPriceOf(1333, { adjustmentPercent: 5 })).toBe(1399.65);
  });

  it('el descuento del cliente se aplica después del precio de la lista', () => {
    // Lista -10% (900) y 5% de descuento adicional en el producto: 855.
    expect(
      resolvePrice(
        1000,
        { adjustmentPercent: -10 },
        { price: null, discountPercent: 5 },
      ),
    ).toBe(855);

    // Lista con precio fijo 800 y 10% adicional: 720.
    expect(
      resolvePrice(
        1000,
        { adjustmentPercent: 0, itemPrice: 800 },
        { price: null, discountPercent: 10 },
      ),
    ).toBe(720);
  });

  it('sin lista, el descuento se aplica sobre el precio normal', () => {
    expect(
      resolvePrice(1000, null, { price: null, discountPercent: 12.5 }),
    ).toBe(875);
  });

  it('un precio especial fijo reemplaza a la lista', () => {
    expect(
      resolvePrice(
        1000,
        { adjustmentPercent: -10 },
        { price: 700, discountPercent: null },
      ),
    ).toBe(700);
  });
});
