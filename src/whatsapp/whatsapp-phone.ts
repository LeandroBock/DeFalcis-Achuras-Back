// WhatsApp identifica los celulares argentinos como 549 + característica +
// número (5493415556789), mientras que los clientes suelen estar cargados como
// 3415556789, 0341 155556789, +54 9 341 555-6789, etc.

const ARGENTINA_MOBILE_PREFIX = '549';
const LOCAL_NUMBER_LENGTH = 10;

export const onlyDigits = (phone: string) => phone.replace(/\D/g, '');

// Clave para comparar teléfonos escritos de distinta forma: los últimos 10
// dígitos (característica + número, sin 0 ni 15 en el caso de Argentina).
export function phoneMatchKey(phone: string) {
  let digits = onlyDigits(phone);

  // 0341 15 5556789 o 341 15 5556789 → 341 5556789. Solo en formato local:
  // con código de país (54...) un "15" en el medio es parte del número.
  const isLocalFormat =
    digits.startsWith('0') ||
    (digits.length === LOCAL_NUMBER_LENGTH + 2 && !digits.startsWith('54'));
  const local = isLocalFormat && digits.match(/^0?(\d{2,4})15(\d{6,8})$/);
  if (local && local[1].length + local[2].length === LOCAL_NUMBER_LENGTH) {
    digits = local[1] + local[2];
  }

  return digits.slice(-LOCAL_NUMBER_LENGTH);
}

// Los últimos 7 dígitos (el número de abonado) son iguales en cualquier
// formato: sirven para buscar candidatos en la base, que después se comparan
// con phoneMatchKey.
export const SUBSCRIBER_DIGITS = 7;

export const phoneSuffixSql = (column: string) =>
  `RIGHT(REGEXP_REPLACE(${column}, '\\D', '', 'g'), ${SUBSCRIBER_DIGITS})`;

export const phoneSuffix = (phone: string) =>
  onlyDigits(phone).slice(-SUBSCRIBER_DIGITS);

// Número en el formato de WhatsApp para enviar un mensaje. Un número local
// argentino de 10 dígitos se completa con 549.
export function toWhatsAppNumber(phone: string) {
  const digits = onlyDigits(phone);

  if (digits.startsWith(ARGENTINA_MOBILE_PREFIX)) {
    return digits;
  }

  // Número local (con 0/15 o de hasta 11 dígitos), con 15 pero sin el 0
  // (341 15 5556789), o 54 sin el 9 de celular.
  if (
    digits.startsWith('0') ||
    digits.length <= LOCAL_NUMBER_LENGTH + 1 ||
    (digits.length === LOCAL_NUMBER_LENGTH + 2 &&
      phoneMatchKey(phone) !== digits.slice(-LOCAL_NUMBER_LENGTH)) ||
    digits.startsWith('54')
  ) {
    return ARGENTINA_MOBILE_PREFIX + phoneMatchKey(phone);
  }

  // Número del exterior: tal cual.
  return digits;
}

// '5493415556789@s.whatsapp.net' o '5493415556789:12@s.whatsapp.net'
// → '5493415556789'
export function phoneFromJid(jid: string) {
  return jid.split('@')[0].split(':')[0];
}
