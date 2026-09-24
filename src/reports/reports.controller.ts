import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';

import { FinancialSummaryQueryDto } from './dto/financial-summary-query.dto.js';
import { ReportsService } from './reports.service.js';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../users/entities/user.entity.js';

@ApiBearerAuth()
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('financial-summary')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.FINANZAS)
  getFinancialSummary(@Query() query: FinancialSummaryQueryDto) {
    return this.reportsService.getFinancialSummary(query);
  }

  @Get('dashboard')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.FINANZAS)
  getDashboard() {
    return this.reportsService.getDashboard();
  }

  @Get('receivables')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.FINANZAS)
  getReceivables(@Query() query: FinancialSummaryQueryDto) {
    return this.reportsService.getReceivables(query);
  }

  @Get('payables')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.FINANZAS)
  getPayables(@Query() query: FinancialSummaryQueryDto) {
    return this.reportsService.getPayables(query);
  }
}
