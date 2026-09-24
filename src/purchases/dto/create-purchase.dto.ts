import {
  ArrayMinSize,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { PurchasePaymentMethod } from '../entities/purchase.entity.js';
import { CreatePurchaseItemDto } from '../../purchase-items/dto/create-purchase-item.dto.js';

export class CreatePurchaseDto {
  @IsNotEmpty()
  @IsUUID()
  supplierId: string;

  @IsEnum(PurchasePaymentMethod)
  paymentMethod: PurchasePaymentMethod;

  @IsOptional()
  @IsString()
  notes?: string;

  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseItemDto)
  @ArrayMinSize(1)
  items: CreatePurchaseItemDto[];
}
