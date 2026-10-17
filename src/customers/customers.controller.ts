import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { ApiBearerAuth } from '@nestjs/swagger';

import { CustomersService } from './customers.service.js';

import { CreateCustomerDto } from './dto/create-customer.dto.js';

import { UpdateCustomerDto } from './dto/update-customer.dto.js';

import { SetCustomerPriceDto } from './dto/set-customer-price.dto.js';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

import { RolesGuard } from '../auth/guards/roles.guard.js';

import { Roles } from '../auth/decorators/roles.decorator.js';

import { UserRole } from '../users/entities/user.entity.js';

@ApiBearerAuth()
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  // Precios especiales del cliente: monto fijo o % de descuento sobre su
  // lista, por producto.
  @Get(':id/prices')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  findPrices(@Param('id', ParseUUIDPipe) id: string) {
    return this.customersService.findPrices(id);
  }

  // Precio final de cada producto para el cliente (lista + descuentos).
  @Get(':id/pricing')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  findPricing(@Param('id', ParseUUIDPipe) id: string) {
    return this.customersService.findPricing(id);
  }

  @Put(':id/prices/:productId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  setPrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: SetCustomerPriceDto,
  ) {
    return this.customersService.setPrice(id, productId, dto);
  }

  @Delete(':id/prices/:productId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  removePrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.customersService.removePrice(id, productId);
  }

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  findAll() {
    return this.customersService.findAll();
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.customersService.findOne(id);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  create(@Body() createCustomerDto: CreateCustomerDto) {
    return this.customersService.create(createCustomerDto);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateCustomerDto: UpdateCustomerDto,
  ) {
    return this.customersService.update(id, updateCustomerDto);
  }

  @Patch(':id/deactivate')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.customersService.deactivate(id);
  }
}
