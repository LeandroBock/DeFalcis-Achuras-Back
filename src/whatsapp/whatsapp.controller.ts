import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../users/entities/user.entity.js';
import { AnalyzeWhatsAppMessageDto } from './dto/analyze-whatsapp-message.dto.js';
import { CreateWhatsAppMessageDto } from './dto/create-whatsapp-message.dto.js';
import { WhatsAppService } from './whatsapp.service.js';
import { PrepareWhatsAppOrderDto } from './dto/prepare-whatsapp-order.dto.js';

@ApiTags('WhatsApp')
@ApiBearerAuth()
@Controller('whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsAppController {
  constructor(private readonly whatsappService: WhatsAppService) {}

  @Post('messages/incoming')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  createIncomingMessage(@Body() dto: CreateWhatsAppMessageDto) {
    return this.whatsappService.createIncomingMessage(dto);
  }

  @Post('messages/outgoing')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  createOutgoingMessage(@Body() dto: CreateWhatsAppMessageDto) {
    return this.whatsappService.createOutgoingMessage(dto);
  }

  @Post('messages/analyze')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  analyzeOrder(@Body() dto: AnalyzeWhatsAppMessageDto) {
    return this.whatsappService.analyzeOrder(dto.message);
  }

  @Get('messages')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  findAll() {
    return this.whatsappService.findAll();
  }

  @Get('messages/:phone')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  findByPhone(@Param('phone') phone: string) {
    return this.whatsappService.findByPhone(phone);
  }

  @Get('conversations')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  getConversations() {
    return this.whatsappService.getConversations();
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
