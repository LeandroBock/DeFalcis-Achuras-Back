import type { WAMessage } from '@whiskeysockets/baileys';

import { WhatsAppMessageType } from '../entities/whatsapp-message.entity.js';

import { toInboundMessage } from './baileys-whatsapp.client.js';

const CUSTOMER_JID = '5493415556789@s.whatsapp.net';

const waMessage = (overrides: Partial<WAMessage> = {}): WAMessage => ({
  key: { remoteJid: CUSTOMER_JID, id: 'ABC123', fromMe: false },
  message: { conversation: 'Hola, quiero 3 kg de chinchulín' },
  messageTimestamp: 1_791_900_000,
  pushName: 'Juan Pérez',
  ...overrides,
});

describe('toInboundMessage', () => {
  it('convierte un mensaje de texto de un cliente', () => {
    expect(toInboundMessage(waMessage())).toEqual({
      externalMessageId: 'ABC123',
      phone: '5493415556789',
      fromMe: false,
      type: WhatsAppMessageType.TEXT,
      text: 'Hola, quiero 3 kg de chinchulín',
      contactName: 'Juan Pérez',
      sentAt: new Date(1_791_900_000 * 1000),
    });
  });

  it('un mensaje escrito desde el celular del negocio queda como propio y sin nombre de contacto', () => {
    const inbound = toInboundMessage(
      waMessage({
        key: { remoteJid: CUSTOMER_JID, id: 'X', fromMe: true },
        pushName: 'DF Achuras',
      }),
    );

    expect(inbound).toMatchObject({ fromMe: true, phone: '5493415556789' });
    expect(inbound?.contactName).toBeUndefined();
  });

  it('texto con formato (respuesta, link, etc.)', () => {
    const inbound = toInboundMessage(
      waMessage({ message: { extendedTextMessage: { text: 'Te respondo' } } }),
    );

    expect(inbound?.text).toBe('Te respondo');
  });

  it('mensajes temporales: se toma el contenido interno', () => {
    const inbound = toInboundMessage(
      waMessage({
        message: {
          ephemeralMessage: { message: { conversation: 'Mensaje temporal' } },
        },
      }),
    );

    expect(inbound?.text).toBe('Mensaje temporal');
  });

  it.each([
    [
      { imageMessage: { caption: 'Así lo quiero' } },
      WhatsAppMessageType.IMAGE,
      'Así lo quiero',
    ],
    [{ imageMessage: {} }, WhatsAppMessageType.IMAGE, '[Imagen]'],
    [{ audioMessage: {} }, WhatsAppMessageType.AUDIO, '[Audio]'],
    [
      { documentMessage: { fileName: 'pedido.pdf' } },
      WhatsAppMessageType.DOCUMENT,
      'pedido.pdf',
    ],
    [{ stickerMessage: {} }, WhatsAppMessageType.OTHER, '[Sticker]'],
    [{ locationMessage: {} }, WhatsAppMessageType.OTHER, '[Ubicación]'],
  ])('contenido multimedia %j', (message, type, text) => {
    expect(toInboundMessage(waMessage({ message }))).toMatchObject({
      type,
      text,
    });
  });

  it('si WhatsApp usa un id anónimo (@lid), toma el número real', () => {
    const inbound = toInboundMessage(
      waMessage({
        key: {
          remoteJid: '123456789012345@lid',
          remoteJidAlt: CUSTOMER_JID,
          id: 'L1',
          fromMe: false,
        },
      }),
    );

    expect(inbound?.phone).toBe('5493415556789');
  });

  it.each([
    ['grupos', { remoteJid: '1203630@g.us', id: 'G' }],
    ['estados', { remoteJid: 'status@broadcast', id: 'S' }],
    ['canales', { remoteJid: '1203630@newsletter', id: 'N' }],
    ['id anónimo sin número', { remoteJid: '123456789012345@lid', id: 'L' }],
    ['sin id', { remoteJid: CUSTOMER_JID }],
  ])('ignora %s', (_, key) => {
    expect(toInboundMessage(waMessage({ key }))).toBeNull();
  });

  it.each([
    ['reacciones', { reactionMessage: { text: '👍' } }],
    ['mensajes de protocolo', { protocolMessage: {} }],
    ['mensajes vacíos', {}],
  ])('ignora %s', (_, message) => {
    expect(toInboundMessage(waMessage({ message }))).toBeNull();
  });
});
