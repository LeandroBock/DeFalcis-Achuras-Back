import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import {
  COLLECTION_METHODS,
  CURRENT_ACCOUNT,
  PaymentMethod,
} from '../../payments/entities/payments.entity.js';

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

  // Con "current_account" no se registra cobro: el saldo queda en la cuenta
  // corriente del cliente.
  @IsIn([...COLLECTION_METHODS, CURRENT_ACCOUNT], {
    message:
      'La forma de cobro tiene que ser efectivo, transferencia o cuenta corriente',
  })
  method: PaymentMethod | typeof CURRENT_ACCOUNT;
}

// Lo que el repartidor carga en el domicilio: lo que se pesó y entregó
// (incluidos productos agregados en el momento) y lo cobrado.
export class DeliverOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveredItemDto)
  items: DeliveredItemDto[];

  // Vacío si el cliente no pagó nada (queda en cuenta corriente). Puede
  // superar el total de la entrega: el excedente paga deuda anterior.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveryPaymentDto)
  payments?: DeliveryPaymentDto[];

  @IsOptional()
  @IsString()
  comment?: string;
}
