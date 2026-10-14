import {
  ArrayMinSize,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

import { Type } from 'class-transformer';

import { CreateOrderItemDto } from '../../order-items/dto/create-order-item.dto.js';

// Nota de pedido: los kilos son los pedidos; los reales se cargan al entregar.
export class CreateOrderDto {
  @IsNotEmpty()
  @IsUUID()
  customerId: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  @ArrayMinSize(1)
  items: CreateOrderItemDto[];

  // Repartidor que la va a entregar.
  @IsOptional()
  @IsUUID()
  assignedToId?: string;

  // AAAA-MM-DD
  @IsOptional()
  @IsDateString({ strict: true })
  deliveryDate?: string;
}
