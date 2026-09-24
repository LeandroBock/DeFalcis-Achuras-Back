import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { InventoryService } from './inventory.service.js';

import { CreateInventoryMovementDto } from './dto/create-inventory-movement.dto.js';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

import { UserRole } from '../users/entities/user.entity.js';

@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.DEPOSITO,
    UserRole.FINANZAS,
  )
  findAll() {
    return this.inventoryService.findAll();
  }

  @Post('movement')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.DEPOSITO)
  create(
    @Body()
    createInventoryMovementDto: CreateInventoryMovementDto,
  ) {
    return this.inventoryService.create(createInventoryMovementDto);
  }
}
