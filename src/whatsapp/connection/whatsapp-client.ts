import { ServiceUnavailableException } from '@nestjs/common';

import { WhatsAppMessageType } from '../entities/whatsapp-message.entity.js';

export const WHATSAPP_CLIENT = Symbol('WHATSAPP_CLIENT');

export enum WhatsAppConnectionStatus {
  // WHATSAPP_ENABLED no está en true (por ejemplo, en desarrollo local).
  DISABLED = 'disabled',
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  // Esperando que se escanee el QR desde el celular.
  WAITING_QR = 'waiting_qr',
  CONNECTED = 'connected',
}

export type WhatsAppConnectionState = {
  status: WhatsAppConnectionStatus;
  // Contenido del QR a escanear (solo en WAITING_QR).
  qr?: string;
  // Número vinculado (solo en CONNECTED).
  phone?: string;
};

// Mensaje recibido de WhatsApp, ya independiente de la librería.
export type InboundWhatsAppMessage = {
  externalMessageId: string;
  phone: string;
  // true si se escribió desde el celular del negocio.
  fromMe: boolean;
  type: WhatsAppMessageType;
  text: string;
  contactName?: string;
  sentAt: Date;
};

export interface WhatsAppClient {
  getState(): WhatsAppConnectionState;
  // Inicia la conexión; si no hay sesión guardada, genera un QR.
  connect(): Promise<void>;
  // Desvincula el dispositivo y borra la sesión.
  logout(): Promise<void>;
  // Envía un texto y devuelve el id del mensaje y el número usado.
  sendText(
    phone: string,
    text: string,
  ): Promise<{ externalMessageId: string; phone: string }>;
  // Envía un archivo (por ejemplo, el PDF del recibo) con un texto opcional.
  sendDocument(
    phone: string,
    document: WhatsAppDocument,
  ): Promise<{ externalMessageId: string; phone: string }>;
}

export type WhatsAppDocument = {
  buffer: Buffer;
  fileName: string;
  mimetype: string;
  caption?: string;
};

export const notConnected = () =>
  new ServiceUnavailableException(
    'WhatsApp no está conectado. Vinculalo escaneando el QR desde la app.',
  );

// Cliente usado cuando WHATSAPP_ENABLED no es true.
export class DisabledWhatsAppClient implements WhatsAppClient {
  getState(): WhatsAppConnectionState {
    return { status: WhatsAppConnectionStatus.DISABLED };
  }

  connect(): Promise<void> {
    return Promise.reject(
      new ServiceUnavailableException(
        'La conexión con WhatsApp está deshabilitada en este servidor (WHATSAPP_ENABLED).',
      ),
    );
  }

  logout(): Promise<void> {
    return Promise.resolve();
  }

  sendText(): Promise<never> {
    return Promise.reject(notConnected());
  }

  sendDocument(): Promise<never> {
    return Promise.reject(notConnected());
  }
}
