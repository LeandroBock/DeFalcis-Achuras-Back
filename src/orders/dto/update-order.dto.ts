import {
  ArrayMinSize,
  IsDateString,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { CreateOrderItemDto } from '../../order-items/dto/create-order-item.dto.js';

// Modificar una nota de pedido todavía no entregada.
export class UpdateOrderDto {
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  @ArrayMinSize(1)
  items?: CreateOrderItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;

  // null para quitar la fecha.
  @ValidateIf((dto: UpdateOrderDto) => dto.deliveryDate !== null)
  @IsOptional()
  @IsDateString({ strict: true })
  deliveryDate?: string | null;
}
