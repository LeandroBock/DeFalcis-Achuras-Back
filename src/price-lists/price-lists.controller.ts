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

import { PriceListsService } from './price-lists.service.js';
import {
  CreatePriceListDto,
  SetPriceListCustomersDto,
  SetPriceListItemDto,
  UpdatePriceListDto,
} from './dto/price-list.dto.js';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../users/entities/user.entity.js';

// Ventas las consulta; super admin y admin las editan (como los precios
// especiales de cada cliente).
const EDIT = [UserRole.SUPER_ADMIN, UserRole.ADMIN];
const VIEW = [...EDIT, UserRole.VENTAS];

@ApiBearerAuth()
@Controller('price-lists')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PriceListsController {
  constructor(private readonly priceLists: PriceListsService) {}

  @Get()
  @Roles(...VIEW)
  findAll() {
    return this.priceLists.findAll();
  }

  @Get(':id')
  @Roles(...VIEW)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.priceLists.findOne(id);
  }

  @Post()
  @Roles(...EDIT)
  create(@Body() dto: CreatePriceListDto) {
    return this.priceLists.create(dto);
  }

  @Patch(':id')
  @Roles(...EDIT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePriceListDto,
  ) {
    return this.priceLists.update(id, dto);
  }

  @Patch(':id/deactivate')
  @Roles(...EDIT)
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.priceLists.deactivate(id);
  }

  // Precio fijo de un producto en la lista.
  @Put(':id/items/:productId')
  @Roles(...EDIT)
  setItemPrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: SetPriceListItemDto,
  ) {
    return this.priceLists.setItemPrice(id, productId, dto.price);
  }

  @Delete(':id/items/:productId')
  @Roles(...EDIT)
  removeItemPrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.priceLists.removeItemPrice(id, productId);
  }

  // Clientes a los que se les cobra con esta lista.
  @Put(':id/customers')
  @Roles(...EDIT)
  setCustomers(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPriceListCustomersDto,
  ) {
    return this.priceLists.setCustomers(id, dto.customerIds);
  }
}
