import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
  Query,
  ForbiddenException,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';

import { OrdersService } from './orders.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { UpdateOrderDto } from './dto/update-order.dto.js';
import { AssignOrderDto, BulkAssignOrdersDto } from './dto/assign-order.dto.js';
import { ReceiptService } from './receipt.service.js';
import { DeliverOrderDto } from './dto/deliver-order.dto.js';
import { NotDeliveredDto } from './dto/not-delivered.dto.js';
import { OrdersQueryDto } from './dto/orders-query.dto.js';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';

import { UserRole } from '../users/entities/user.entity.js';

const OFFICE = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS];

@ApiBearerAuth()
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly receipts: ReceiptService,
  ) {}

  // Filtros opcionales: ?status=pending&assignedToId=...&deliveryDate=AAAA-MM-DD
  @Get()
  @Roles(...OFFICE, UserRole.FINANZAS)
  findAll(@Query() query: OrdersQueryDto) {
    return this.ordersService.findAll(query);
  }

  // Recibo X de una entrega (PDF). El repartidor solo ve los suyos.
  @Get(':id/receipt')
  @Roles(...OFFICE, UserRole.FINANZAS, UserRole.REPARTO)
  async receipt(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    if (user.role === UserRole.REPARTO) {
      const { order } = await this.ordersService.findOne(id);
      if (order.deliveredById !== user.sub) {
        throw new ForbiddenException('Este recibo no es de una entrega tuya');
      }
    }

    const { buffer, filename } = await this.receipts.pdf(id);

    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get(':id')
  @Roles(...OFFICE, UserRole.FINANZAS)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findOne(id);
  }

  // Nueva nota de pedido (kilos pedidos; los reales se cargan al entregar).
  @Post()
  @Roles(...OFFICE)
  create(@Body() createOrderDto: CreateOrderDto) {
    return this.ordersService.create(createOrderDto);
  }

  // Modificar una nota todavía no entregada.
  @Patch(':id')
  @Roles(...OFFICE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderDto) {
    return this.ordersService.update(id, dto);
  }

  // Asignar muchas notas de una vez al mismo repartidor.
  @Post('assign')
  @Roles(...OFFICE)
  assignMany(@Body() dto: BulkAssignOrdersDto) {
    return this.ordersService.assignMany(dto);
  }

  @Post(':id/assign')
  @Roles(...OFFICE)
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignOrderDto) {
    return this.ordersService.assign(id, dto);
  }

  @Post(':id/cancel')
  @Roles(...OFFICE)
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.cancel(id);
  }

  // Entrega: kilos pesados, productos agregados o no llevados, y lo cobrado.
  // Un repartidor solo puede entregar sus notas.
  @Post(':id/deliver')
  @Roles(...OFFICE, UserRole.REPARTO)
  deliver(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeliverOrderDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ordersService.deliver(id, dto, user);
  }

  @Post(':id/not-delivered')
  @Roles(...OFFICE, UserRole.REPARTO)
  notDelivered(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NotDeliveredDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ordersService.markNotDelivered(id, dto.reason, user);
  }
}
