import {
  FACTURA_A,
  FACTURA_B,
  FACTURA_C,
  computeInvoice,
  isValidCuit,
  issuerIsMonotributo,
  resolveDocument,
  voucherTypeFor,
} from './invoice-calc.js';

describe('cálculos de la factura', () => {
  it('valida el dígito verificador del CUIT', () => {
    expect(isValidCuit('20-11111111-2')).toBe(true);
    expect(isValidCuit('30712345671')).toBe(true);
    expect(isValidCuit('30712345672')).toBe(false);
    expect(isValidCuit('20111111113')).toBe(false);
    expect(isValidCuit('2011111111')).toBe(false);
  });

  it('factura siempre A (C solo si el emisor fuera monotributista)', () => {
    expect(voucherTypeFor(false)).toBe(FACTURA_A);
    expect(voucherTypeFor(true)).toBe(FACTURA_C);
    expect(issuerIsMonotributo('Responsable Monotributo')).toBe(true);
    expect(issuerIsMonotributo('IVA Responsable Inscripto')).toBe(false);
  });

  it('identifica CUIT, DNI o consumidor final sin identificar', () => {
    expect(resolveDocument('20-11111111-2')).toEqual({
      docTipo: 80,
      docNro: 20111111112,
    });
    expect(resolveDocument('12.345.678')).toEqual({
      docTipo: 96,
      docNro: 12345678,
    });
    expect(resolveDocument('')).toEqual({ docTipo: 99, docNro: 0 });
  });

  const items = [
    {
      name: 'Chinchulín',
      unit: 'kg',
      quantity: 2,
      unitPrice: 1000,
      subtotal: 2000,
      vatRate: 10.5,
    },
    {
      name: 'Carbón',
      unit: 'u',
      quantity: 1,
      unitPrice: 1210,
      subtotal: 1210,
      vatRate: 21,
    },
  ];

  it('separa neto e IVA por alícuota (precios con IVA incluido)', () => {
    const calc = computeInvoice(items, FACTURA_A);

    expect(calc.totalCents).toBe(321000);
    expect(calc.vatByRate).toEqual([
      { rate: 10.5, baseCents: 180995, vatCents: 19005 },
      { rate: 21, baseCents: 100000, vatCents: 21000 },
    ]);
    expect(calc.netCents + calc.vatCents).toBe(calc.totalCents);
    expect(calc.invalidRates).toEqual([]);
  });

  it('la Factura C no discrimina IVA', () => {
    const calc = computeInvoice(items, FACTURA_C);

    expect(calc.vatCents).toBe(0);
    expect(calc.netCents).toBe(321000);
  });

  it('detecta alícuotas que ARCA no acepta', () => {
    const calc = computeInvoice([{ ...items[0], vatRate: 12 }], FACTURA_B);
    expect(calc.invalidRates).toEqual([12]);
  });
});
