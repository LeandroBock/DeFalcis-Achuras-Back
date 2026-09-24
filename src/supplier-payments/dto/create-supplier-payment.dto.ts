import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

import { SupplierPaymentMethod } from '../entities/supplier-payment.entity.js';

export class CreateSupplierPaymentDto {
  @IsUUID()
  purchaseId: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsEnum(SupplierPaymentMethod)
  method: SupplierPaymentMethod;

  @IsOptional()
  @IsString()
  notes?: string;
}
