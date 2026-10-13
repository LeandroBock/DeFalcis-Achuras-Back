import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UseGuards,
  Query,
} from '@nestjs/common';
import { InvoicePdfService } from './invoice-pdf.service.js';
import { ApiBearerAuth } from '@nestjs/swagger';

import { EmitInvoicesDto } from './dto/emit-invoices.dto.js';
import { InvoicingService } from './invoicing.service.js';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../users/entities/user.entity.js';
import { PaginationQueryDto } from '../common/pagination.js';

@ApiBearerAuth()
@Controller('invoicing')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvoicingController {
  constructor(
    private readonly invoicingService: InvoicingService,
    private readonly invoicePdfService: InvoicePdfService,
  ) {}

  @Get(':id/pdf')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.FINANZAS)
  async getPdf(@Param('id', ParseUUIDPipe) id: string) {
    const { buffer, filename } = await this.invoicePdfService.generate(id);

    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.FINANZAS)
  findAll(@Query() query: PaginationQueryDto) {
    return this.invoicingService.findAll(query);
  }

  @Post('emit')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.FINANZAS)
  emit(@Body() dto: EmitInvoicesDto) {
    return this.invoicingService.emit(dto.orderIds);
  }
}
