// Cálculos de la factura, compartidos por la vista previa, la emisión en ARCA
// y el PDF: así lo que se revisa es exactamente lo que se emite.

// Tipos de comprobante
export const FACTURA_A = 1;
export const FACTURA_B = 6;
export const FACTURA_C = 11;

export const VOUCHER: Record<number, { letter: string; code: string }> = {
  [FACTURA_A]: { letter: 'A', code: '001' },
  [FACTURA_B]: { letter: 'B', code: '006' },
  [FACTURA_C]: { letter: 'C', code: '011' },
};

// Condición IVA del receptor (ARCA)
export const IVA_RESP_INSCRIPTO = 1;
export const IVA_EXENTO = 4;
export const IVA_CONSUMIDOR_FINAL = 5;
export const IVA_MONOTRIBUTO = 6;

export const IVA_CONDITION_LABEL: Record<number, string> = {
  [IVA_RESP_INSCRIPTO]: 'IVA Responsable Inscripto',
  [IVA_EXENTO]: 'IVA Sujeto Exento',
  [IVA_CONSUMIDOR_FINAL]: 'Consumidor Final',
  [IVA_MONOTRIBUTO]: 'Responsable Monotributo',
};

// Alícuota (%) -> Id de ARCA (FEParamGetTiposIva)
export const VAT_ID_BY_RATE: Record<string, number> = {
  '0': 3,
  '2.5': 9,
  '5': 8,
  '10.5': 4,
  '21': 5,
  '27': 6,
};

export const toCents = (value: number | string) =>
  Math.round(Number(value) * 100);

// La empresa factura siempre A (responsable inscripto). Un emisor
// monotributista emitiría Factura C (sin IVA discriminado).
export function issuerIsMonotributo(ivaCondition: string) {
  return /monotribut/i.test(ivaCondition);
}

export function voucherTypeFor(issuerMonotributo: boolean) {
  return issuerMonotributo ? FACTURA_C : FACTURA_A;
}

// Condiciones de IVA del receptor que ARCA acepta en una Factura A.
export const FACTURA_A_CONDITIONS = [IVA_RESP_INSCRIPTO, IVA_MONOTRIBUTO];

// 80 = CUIT, 96 = DNI, 99 = Consumidor Final sin identificar
export function resolveDocument(taxId?: string | null) {
  const digits = (taxId ?? '').replace(/\D/g, '');

  if (digits.length === 11) return { docTipo: 80, docNro: Number(digits) };
  if (digits.length >= 7 && digits.length <= 8) {
    return { docTipo: 96, docNro: Number(digits) };
  }
  return { docTipo: 99, docNro: 0 };
}

// Dígito verificador del CUIT/CUIL (módulo 11).
export function isValidCuit(value: string) {
  const digits = value.replace(/\D/g, '');
  if (!/^\d{11}$/.test(digits)) return false;

  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  const mod = 11 - (sum % 11);
  const check = mod === 11 ? 0 : mod === 10 ? 9 : mod;

  return check === Number(digits[10]);
}

export interface InvoiceItemInput {
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  vatRate: number;
}

export interface InvoiceLine {
  name: string;
  unit: string;
  qty: number;
  rate: number;
  grossCents: number;
  netCents: number;
  unitGrossCents: number;
  unitNetCents: number;
}

// Los precios de venta incluyen IVA: se calcula el neto de cada alícuota.
export function computeInvoice(items: InvoiceItemInput[], voucherType: number) {
  const withoutVat = voucherType === FACTURA_C;

  const lines: InvoiceLine[] = items.map((item) => {
    const rate = withoutVat ? 0 : Number(item.vatRate);
    const factor = 1 + rate / 100;
    const grossCents = toCents(item.subtotal);

    return {
      name: item.name,
      unit: item.unit === 'kg' ? 'kg' : 'u.',
      qty: Number(item.quantity),
      rate,
      grossCents,
      netCents: Math.round(grossCents / factor),
      unitGrossCents: toCents(item.unitPrice),
      unitNetCents: Math.round(toCents(item.unitPrice) / factor),
    };
  });

  const grossByRate = new Map<number, number>();
  lines.forEach((l) =>
    grossByRate.set(l.rate, (grossByRate.get(l.rate) ?? 0) + l.grossCents),
  );

  let totalCents = 0;
  let netCents = 0;
  let vatCents = 0;
  const vatByRate: { rate: number; baseCents: number; vatCents: number }[] = [];

  [...grossByRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .forEach(([rate, gross]) => {
      const base = Math.round(gross / (1 + rate / 100));
      totalCents += gross;
      netCents += base;
      vatCents += gross - base;
      vatByRate.push({ rate, baseCents: base, vatCents: gross - base });
    });

  const invalidRates = withoutVat
    ? []
    : [...new Set(items.map((i) => Number(i.vatRate)))].filter(
        (rate) => VAT_ID_BY_RATE[String(rate)] === undefined,
      );

  return { lines, totalCents, netCents, vatCents, vatByRate, invalidRates };
}

export const formatVoucherNumber = (ptoVta: number, cbteNro: number) =>
  `${String(ptoVta).padStart(5, '0')}-${String(cbteNro).padStart(8, '0')}`;
