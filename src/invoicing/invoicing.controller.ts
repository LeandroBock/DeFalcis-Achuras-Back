import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';

import {
  EmitInvoiceDto,
  InvoicePreviewDto,
  SendInvoiceEmailDto,
} from './dto/emit-invoice.dto.js';
import { InvoicingService } from './invoicing.service.js';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { UserRole } from '../users/entities/user.entity.js';
import { PaginationQueryDto } from '../common/pagination.js';

const pdfFile = (buffer: Buffer, filename: string) =>
  new StreamableFile(buffer, {
    type: 'application/pdf',
    disposition: `attachment; filename="${filename}"`,
  });

@ApiBearerAuth()
@Controller('invoicing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.FINANZAS)
export class InvoicingController {
  constructor(private readonly invoicingService: InvoicingService) {}

  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.invoicingService.findAll(query);
  }

  // Lo que se va a facturar, para revisarlo antes de emitir.
  @Post('preview')
  @HttpCode(200)
  preview(@Body() dto: InvoicePreviewDto) {
    return this.invoicingService.preview(dto.orderId, dto.customer);
  }

  @Post('preview/pdf')
  @HttpCode(200)
  async previewPdf(@Body() dto: InvoicePreviewDto) {
    const { buffer, filename } = await this.invoicingService.draftPdf(
      dto.orderId,
      dto.customer,
    );
    return pdfFile(buffer, filename);
  }

  @Post('emit')
  emit(@Body() dto: EmitInvoiceDto) {
    return this.invoicingService.emitReviewed(dto);
  }

  @Get(':id/pdf')
  async getPdf(@Param('id', ParseUUIDPipe) id: string) {
    const { buffer, filename } = await this.invoicingService.pdf(id);
    return pdfFile(buffer, filename);
  }

  @Post(':id/email')
  @HttpCode(200)
  sendEmail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendInvoiceEmailDto,
  ) {
    return this.invoicingService.sendEmail(id, dto.to);
  }
}
