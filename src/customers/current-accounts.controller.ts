import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';

import { CurrentAccountsService } from './current-accounts.service.js';
import { PayCurrentAccountDto } from './dto/pay-current-account.dto.js';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
import { UserRole } from '../users/entities/user.entity.js';

@ApiBearerAuth()
@Controller('current-accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CurrentAccountsController {
  constructor(private readonly currentAccounts: CurrentAccountsService) {}

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.VENTAS,
    UserRole.FINANZAS,
  )
  list() {
    return this.currentAccounts.list();
  }

  @Get(':customerId')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.VENTAS,
    UserRole.FINANZAS,
  )
  detail(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.currentAccounts.detail(customerId);
  }

  @Post(':customerId/payments')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.VENTAS,
    UserRole.FINANZAS,
  )
  pay(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: PayCurrentAccountDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.currentAccounts.pay(customerId, dto, user.sub);
  }
}
