import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { SupplierPaymentsService } from './supplier-payments.service.js';

import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto.js';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

import { RolesGuard } from '../auth/guards/roles.guard.js';

import { Roles } from '../auth/decorators/roles.decorator.js';

import { UserRole } from '../users/entities/user.entity.js';

@Controller('supplier-payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SupplierPaymentsController {
  constructor(
    private readonly supplierPaymentsService: SupplierPaymentsService,
  ) {}

  @Get('purchase/:purchaseId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.FINANZAS)
  findByPurchase(
    @Param('purchaseId', ParseUUIDPipe)
    purchaseId: string,
  ) {
    return this.supplierPaymentsService.findByPurchase(purchaseId);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.FINANZAS)
  create(@Body() dto: CreateSupplierPaymentDto) {
    return this.supplierPaymentsService.create(dto);
  }
}
