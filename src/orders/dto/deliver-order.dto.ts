import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { PaymentMethod } from '../../payments/entities/payments.entity.js';

export class DeliveredItemDto {
  @IsUUID()
  productId: string;

  // Kilos/unidades entregados. 0 si el cliente no lo quiso.
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity: number;
}

export class DeliveryPaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @IsEnum(PaymentMethod)
  method: PaymentMethod;
}

// Lo que el repartidor carga en el domicilio: lo que se pesó y entregó
// (incluidos productos agregados en el momento) y lo cobrado.
export class DeliverOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveredItemDto)
  items: DeliveredItemDto[];

  // Vacío si el cliente no pagó nada (queda en cuenta corriente).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveryPaymentDto)
  payments?: DeliveryPaymentDto[];

  @IsOptional()
  @IsString()
  comment?: string;
}
