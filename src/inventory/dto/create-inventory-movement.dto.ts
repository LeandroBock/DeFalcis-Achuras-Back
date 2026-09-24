import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

import { InventoryMovementType } from '../entities/inventory-movement.entity.js';

export class CreateInventoryMovementDto {
  @IsUUID()
  productId: string;

  @IsEnum(InventoryMovementType)
  type: InventoryMovementType;

  @IsNumber()
  @Min(0.001)
  quantity: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
