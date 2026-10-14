import {
  Body,
  Controller,
  Get,
  Inject,
  MessageEvent,
  Param,
  Post,
  Sse,
  UseGuards,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import QRCode from 'qrcode';
import { Observable, interval, map, merge, startWith } from 'rxjs';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../users/entities/user.entity.js';
import { AnalyzeWhatsAppMessageDto } from './dto/analyze-whatsapp-message.dto.js';
import { CreateWhatsAppMessageDto } from './dto/create-whatsapp-message.dto.js';
import { WhatsAppService } from './whatsapp.service.js';
import { PrepareWhatsAppOrderDto } from './dto/prepare-whatsapp-order.dto.js';
import { PaginationQueryDto } from '../common/pagination.js';
import { AllowQueryToken } from '../auth/decorators/allow-query-token.decorator.js';
import { WHATSAPP_CLIENT } from './connection/whatsapp-client.js';
import type { WhatsAppClient } from './connection/whatsapp-client.js';
import { SendWhatsAppMessageDto } from './dto/send-whatsapp-message.dto.js';
import { WhatsAppEventsService } from './whatsapp-events.service.js';
import { WhatsAppInboxService } from './whatsapp-inbox.service.js';

// Cada cuánto se manda un evento vacío para que proxies como el de Render no
// corten la conexión de eventos por inactividad.
const EVENTS_HEARTBEAT_MS = 25_000;

@ApiTags('WhatsApp')
@ApiBearerAuth()
@Controller('whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsAppController {
  constructor(
    private readonly whatsappService: WhatsAppService,
    private readonly inbox: WhatsAppInboxService,
    private readonly events: WhatsAppEventsService,
    @Inject(WHATSAPP_CLIENT) private readonly client: WhatsAppClient,
  ) {}

  // ---------- Conexión (vincular el celular con el QR) ----------

  // Estado de la conexión y, si está esperando, el QR como imagen (data URL)
  // para mostrar en un <img>.
  @Get('connection')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async getConnection() {
    const { status, qr, phone } = this.client.getState();

    return {
      status,
      phone: phone ?? null,
      qr: qr ? await QRCode.toDataURL(qr, { margin: 1, width: 300 }) : null,
    };
  }

  @Post('connection/connect')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async connect() {
    await this.client.connect();
    return this.getConnection();
  }

  @Post('connection/logout')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async logout() {
    await this.client.logout();
    return this.getConnection();
  }

  // Eventos en tiempo real (Server-Sent Events) para la bandeja: mensajes
  // nuevos y cambios de conexión. Desde el navegador:
  //   new EventSource(`${API}/whatsapp/events?access_token=${token}`)
  @Sse('events')
  @AllowQueryToken()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  streamEvents(): Observable<MessageEvent> {
    return merge(
      this.events.stream().pipe(
        startWith({ type: 'connection', data: this.client.getState() }),
        map(({ type, data }) => ({ type, data: this.withoutQr(type, data) })),
      ),
      interval(EVENTS_HEARTBEAT_MS).pipe(
        map(() => ({ type: 'ping', data: {} })),
      ),
    );
  }

  // ---------- Mensajes ----------

  // Envía un mensaje real por WhatsApp a esa conversación.
  @Post('conversations/:phone/messages')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  sendMessage(
    @Param('phone') phone: string,
    @Body() dto: SendWhatsAppMessageDto,
  ) {
    return this.inbox.send(phone, dto.message);
  }

  // El QR solo lo ven los administradores (GET /whatsapp/connection).
  private withoutQr(type: string, data: object): object {
    if (type !== 'connection') return data;
    const { qr: _qr, ...rest } = data as { qr?: string };
    return rest;
  }

  @Post('messages/incoming')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  createIncomingMessage(@Body() dto: CreateWhatsAppMessageDto) {
    return this.whatsappService.createIncomingMessage(dto);
  }

  // Envía el mensaje por WhatsApp (igual que POST conversations/:phone/messages).
  @Post('messages/outgoing')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  createOutgoingMessage(@Body() dto: CreateWhatsAppMessageDto) {
    return this.inbox.send(dto.phone, dto.message);
  }

  @Post('messages/analyze')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  analyzeOrder(@Body() dto: AnalyzeWhatsAppMessageDto) {
    return this.whatsappService.analyzeOrder(dto.message);
  }

  @Get('messages')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  findAll(@Query() query: PaginationQueryDto) {
    return this.whatsappService.findAll(query);
  }

  @Get('messages/:phone')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  findByPhone(@Param('phone') phone: string) {
    return this.whatsappService.findByPhone(phone);
  }

  @Get('conversations')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  getConversations(@Query() query: PaginationQueryDto) {
    return this.whatsappService.getConversations(query);
  }

  @Get('conversations/:phone')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  getConversation(@Param('phone') phone: string) {
    return this.whatsappService.getConversation(phone);
  }

  @Post('orders/prepare')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  prepareOrder(@Body() dto: PrepareWhatsAppOrderDto) {
    return this.whatsappService.prepareOrder(dto);
  }

  @Post('orders/:id/confirm')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  confirmOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.whatsappService.confirmOrder(id);
  }

  @Post('messages/process')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  processIncomingMessage(@Body() dto: PrepareWhatsAppOrderDto) {
    return this.whatsappService.processIncomingMessage(dto);
  }
}
