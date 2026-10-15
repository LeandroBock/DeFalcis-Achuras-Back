import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

import {
  COLLECTION_METHODS,
  PaymentMethod,
} from '../entities/payments.entity.js';

export class CreatePaymentDto {
  @IsUUID()
  orderId: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsIn(COLLECTION_METHODS, {
    message: 'La forma de cobro tiene que ser efectivo o transferencia',
  })
  method: PaymentMethod;

  @IsOptional()
  @IsString()
  notes?: string;
}
