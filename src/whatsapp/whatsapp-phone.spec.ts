import {
  phoneFromJid,
  phoneMatchKey,
  toWhatsAppNumber,
} from './whatsapp-phone.js';

describe('teléfonos de WhatsApp', () => {
  it.each([
    ['5493415556789'],
    ['3415556789'],
    ['+54 9 341 555-6789'],
    ['0341 15 5556789'],
    ['0341155556789'],
    ['(341) 555-6789'],
  ])('%s se reconoce como el mismo número', (phone) => {
    expect(phoneMatchKey(phone)).toBe('3415556789');
  });

  it('el 0/15 también se quita con características de 2 y 4 dígitos', () => {
    expect(phoneMatchKey('011 15 55556789')).toBe('1155556789');
    expect(phoneMatchKey('02954 15 556789')).toBe('2954556789');
  });

  it.each([
    ['3415556789', '5493415556789'],
    ['0341 15 5556789', '5493415556789'],
    ['341 15 5556789', '5493415556789'],
    ['11 15 55556789', '5491155556789'],
    ['5493415556789', '5493415556789'],
    ['543415556789', '5493415556789'],
    ['+54 9 341 555-6789', '5493415556789'],
    ['34155567890123', '34155567890123'], // número del exterior: sin cambios
  ])('%s se envía a %s', (phone, expected) => {
    expect(toWhatsAppNumber(phone)).toBe(expected);
  });

  it('extrae el número de un JID de WhatsApp', () => {
    expect(phoneFromJid('5493415556789@s.whatsapp.net')).toBe('5493415556789');
    expect(phoneFromJid('5493415556789:12@s.whatsapp.net')).toBe(
      '5493415556789',
    );
  });
});
