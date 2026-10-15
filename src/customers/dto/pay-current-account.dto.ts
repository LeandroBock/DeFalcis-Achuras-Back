import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

import {
  COLLECTION_METHODS,
  PaymentMethod,
} from '../../payments/entities/payments.entity.js';

export class PayCurrentAccountDto {
  @IsNumber({ maxDecimalPlaces: 2 })
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
