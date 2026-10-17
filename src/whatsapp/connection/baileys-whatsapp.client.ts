import {
  BadRequestException,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import makeWASocket, {
  AnyMessageContent,
  Browsers,
  ConnectionState,
  DisconnectReason,
  WAMessage,
  WASocket,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  isJidGroup,
  isJidStatusBroadcast,
  isLidUser,
  isPnUser,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
  proto,
} from '@whiskeysockets/baileys';
import type { ILogger } from '@whiskeysockets/baileys/lib/Utils/logger.js';
import { Repository } from 'typeorm';

import { WhatsAppAuth } from '../entities/whatsapp-auth.entity.js';
import { WhatsAppMessageType } from '../entities/whatsapp-message.entity.js';
import { WhatsAppEventsService } from '../whatsapp-events.service.js';
import { phoneFromJid, toWhatsAppNumber } from '../whatsapp-phone.js';

import {
  clearStoredSession,
  hasStoredSession,
  useDatabaseAuthState,
} from './database-auth-state.js';
import {
  InboundWhatsAppMessage,
  WhatsAppClient,
  WhatsAppDocument,
  WhatsAppConnectionState,
  WhatsAppConnectionStatus,
  notConnected,
} from './whatsapp-client.js';

const MAX_RECONNECT_DELAY_MS = 60_000;

// Conexión con WhatsApp como un dispositivo vinculado (igual que WhatsApp
// Web), usando Baileys. El celular del negocio sigue funcionando normalmente.
// Se crea en WhatsAppModule solo si WHATSAPP_ENABLED=true.
export class BaileysWhatsAppClient
  implements WhatsAppClient, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger('WhatsApp');
  private socket?: WASocket;
  private state: WhatsAppConnectionState = {
    status: WhatsAppConnectionStatus.DISCONNECTED,
  };
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private stopping = false;

  constructor(
    private readonly authRepository: Repository<WhatsAppAuth>,
    private readonly events: WhatsAppEventsService,
  ) {}

  // Si ya había un dispositivo vinculado, se reconecta solo al arrancar.
  async onApplicationBootstrap() {
    if (await hasStoredSession(this.authRepository)) {
      this.connect().catch((error) =>
        this.logger.error(`No se pudo conectar: ${error}`),
      );
    }
  }

  async onModuleDestroy() {
    this.stopping = true;
    clearTimeout(this.reconnectTimer);
    // Cierra la conexión sin desvincular el dispositivo.
    await this.socket?.end(undefined);
  }

  getState() {
    return this.state;
  }

  async connect() {
    if (this.socket) {
      return;
    }

    this.stopping = false;
    this.setState({ status: WhatsAppConnectionStatus.CONNECTING });

    const { state, saveCreds } = await useDatabaseAuthState(
      this.authRepository,
    );
    const { version } = await fetchLatestBaileysVersion().catch(() => ({
      version: undefined,
    }));
    const logger = baileysLogger(this.logger);

    const socket = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      browser: Browsers.appropriate('DF Achuras'),
      // No marcarse "en línea": el celular sigue recibiendo notificaciones.
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });

    this.socket = socket;

    socket.ev.on('creds.update', () => {
      saveCreds().catch((error) =>
        this.logger.error(`No se pudo guardar la sesión: ${error}`),
      );
    });

    socket.ev.on('connection.update', (update) =>
      this.onConnectionUpdate(socket, update),
    );

    socket.ev.on('messages.upsert', ({ messages, type }) => {
      // 'notify' son mensajes nuevos; 'append' es historial sincronizado.
      if (type !== 'notify') return;

      for (const message of messages) {
        const inbound = toInboundMessage(message);
        if (inbound) this.events.inbound(inbound);
      }
    });
  }

  async logout() {
    clearTimeout(this.reconnectTimer);
    this.stopping = true;

    const socket = this.socket;
    this.socket = undefined;

    await socket?.logout().catch(() => undefined);
    await clearStoredSession(this.authRepository);

    this.setState({ status: WhatsAppConnectionStatus.DISCONNECTED });
  }

  async sendText(phone: string, text: string) {
    return this.send(phone, { text });
  }

  async sendDocument(phone: string, document: WhatsAppDocument) {
    return this.send(phone, {
      document: document.buffer,
      fileName: document.fileName,
      mimetype: document.mimetype,
      caption: document.caption,
    });
  }

  private async send(phone: string, content: AnyMessageContent) {
    const socket = this.socket;

    if (!socket || this.state.status !== WhatsAppConnectionStatus.CONNECTED) {
      throw notConnected();
    }

    const number = toWhatsAppNumber(phone);
    const [contact] = (await socket.onWhatsApp(number)) ?? [];

    if (!contact?.exists) {
      throw new BadRequestException(`El número ${number} no tiene WhatsApp`);
    }

    const sent = await socket.sendMessage(contact.jid, content);

    if (!sent?.key.id) {
      throw new Error('WhatsApp no confirmó el envío del mensaje');
    }

    return {
      externalMessageId: sent.key.id,
      phone: phoneFromJid(contact.jid),
    };
  }

  private onConnectionUpdate(
    socket: WASocket,
    { connection, lastDisconnect, qr }: Partial<ConnectionState>,
  ) {
    // Una conexión vieja que se cierra no debe pisar el estado de la nueva.
    if (socket !== this.socket) return;

    if (qr) {
      this.setState({ status: WhatsAppConnectionStatus.WAITING_QR, qr });
    }

    if (connection === 'open') {
      this.reconnectAttempts = 0;
      this.setState({
        status: WhatsAppConnectionStatus.CONNECTED,
        phone: socket.user?.id ? phoneFromJid(socket.user.id) : undefined,
      });
      this.logger.log(`Conectado como ${this.state.phone}`);
    }

    if (connection === 'close') {
      this.socket = undefined;
      const code = (
        lastDisconnect?.error as { output?: { statusCode?: number } }
      )?.output?.statusCode;

      void this.onClose(code);
    }
  }

  private async onClose(code?: number) {
    if (this.stopping) return;

    // Se desvinculó desde el celular: hay que escanear el QR de nuevo.
    if (code === DisconnectReason.loggedOut) {
      this.logger.warn('El dispositivo fue desvinculado desde el celular');
      await clearStoredSession(this.authRepository);
      this.setState({ status: WhatsAppConnectionStatus.DISCONNECTED });
      return;
    }

    // Otra instancia del servidor tomó la sesión: no pelearse por ella.
    if (code === DisconnectReason.connectionReplaced) {
      this.logger.warn('La sesión se abrió en otro servidor');
      this.setState({ status: WhatsAppConnectionStatus.DISCONNECTED });
      return;
    }

    // Nunca se escaneó el QR y se venció: no generar QRs indefinidamente.
    if (!(await hasStoredSession(this.authRepository))) {
      this.setState({ status: WhatsAppConnectionStatus.DISCONNECTED });
      return;
    }

    // Corte de conexión, reinicio pedido por WhatsApp (justo después de
    // escanear el QR), etc.: reconectar esperando cada vez un poco más.
    const delay = Math.min(
      1000 * 2 ** this.reconnectAttempts,
      MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempts++;
    this.logger.warn(`Conexión cerrada (${code}); reintentando en ${delay} ms`);
    this.setState({ status: WhatsAppConnectionStatus.CONNECTING });

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error) =>
        this.logger.error(`No se pudo reconectar: ${error}`),
      );
    }, delay);
  }

  private setState(state: WhatsAppConnectionState) {
    this.state = state;
    this.events.emit({ type: 'connection', data: state });
  }
}

// Convierte un mensaje de Baileys al formato de la app. Devuelve null para lo
// que no es una conversación con un cliente (grupos, estados, reacciones,
// mensajes de sistema, etc.).
export function toInboundMessage(
  message: WAMessage,
): InboundWhatsAppMessage | null {
  const { key } = message;
  const jid = key.remoteJid;

  if (!jid || !key.id) return null;
  if (isJidGroup(jid) || isJidBroadcast(jid) || isJidStatusBroadcast(jid)) {
    return null;
  }
  if (jid.endsWith('@newsletter')) return null;

  // WhatsApp puede identificar al contacto con un id anónimo (@lid); el número
  // real viene entonces en remoteJidAlt.
  const phoneJid = isLidUser(jid) ? key.remoteJidAlt : jid;
  if (!phoneJid || !isPnUser(phoneJid)) return null;

  const content = normalizeMessageContent(message.message);
  if (!content) return null;

  const described = describeContent(content);
  if (!described) return null;

  return {
    externalMessageId: key.id,
    phone: phoneFromJid(phoneJid),
    fromMe: !!key.fromMe,
    type: described.type,
    text: described.text,
    contactName: (!key.fromMe && message.pushName) || undefined,
    sentAt: message.messageTimestamp
      ? new Date(Number(message.messageTimestamp) * 1000)
      : new Date(),
  };
}

function describeContent(
  content: proto.IMessage,
): { type: WhatsAppMessageType; text: string } | null {
  const text = (value: string | null | undefined, fallback: string) =>
    value?.trim() || fallback;

  if (content.conversation) {
    return { type: WhatsAppMessageType.TEXT, text: content.conversation };
  }
  if (content.extendedTextMessage?.text) {
    return {
      type: WhatsAppMessageType.TEXT,
      text: content.extendedTextMessage.text,
    };
  }
  if (content.imageMessage) {
    return {
      type: WhatsAppMessageType.IMAGE,
      text: text(content.imageMessage.caption, '[Imagen]'),
    };
  }
  if (content.audioMessage) {
    return { type: WhatsAppMessageType.AUDIO, text: '[Audio]' };
  }
  if (content.documentMessage) {
    return {
      type: WhatsAppMessageType.DOCUMENT,
      text: text(
        content.documentMessage.caption ?? content.documentMessage.fileName,
        '[Documento]',
      ),
    };
  }
  if (content.videoMessage) {
    return {
      type: WhatsAppMessageType.OTHER,
      text: text(content.videoMessage.caption, '[Video]'),
    };
  }
  if (content.stickerMessage) {
    return { type: WhatsAppMessageType.OTHER, text: '[Sticker]' };
  }
  if (content.locationMessage) {
    return { type: WhatsAppMessageType.OTHER, text: '[Ubicación]' };
  }
  if (content.contactMessage || content.contactsArrayMessage) {
    return { type: WhatsAppMessageType.OTHER, text: '[Contacto]' };
  }

  // Reacciones, ediciones, mensajes de protocolo, etc.
  return null;
}

// Adapta el logger de Baileys (muy verboso) al de Nest: solo avisos y errores.
function baileysLogger(logger: Logger): ILogger {
  const format = (obj: unknown, msg?: string) =>
    msg ?? (typeof obj === 'string' ? obj : JSON.stringify(obj));

  const adapter: ILogger = {
    level: 'warn',
    child: () => adapter,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: (obj, msg) => logger.warn(format(obj, msg)),
    error: (obj, msg) => logger.error(format(obj, msg)),
  };

  return adapter;
}
