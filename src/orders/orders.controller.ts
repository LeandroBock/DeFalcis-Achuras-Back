import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';

import { OrdersService } from './orders.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

import { UserRole } from '../users/entities/user.entity.js';
import { PaginationQueryDto } from '../common/pagination.js';

@ApiBearerAuth()
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.VENTAS,
    UserRole.FINANZAS,
  )
  findAll(@Query() query: PaginationQueryDto) {
    return this.ordersService.findAll(query);
  }

  @Get(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.VENTAS,
    UserRole.FINANZAS,
  )
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findOne(id);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  create(@Body() createOrderDto: CreateOrderDto) {
    return this.ordersService.create(createOrderDto);
  }
}
