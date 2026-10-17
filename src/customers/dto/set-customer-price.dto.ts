import { IsNumber, Max, Min, ValidateIf } from 'class-validator';

// Uno de los dos: un precio fijo, o un descuento en % que se aplica sobre el
// precio de la lista del cliente (o el normal si no tiene lista).
export class SetCustomerPriceDto {
  @ValidateIf((dto: SetCustomerPriceDto) => dto.discountPercent === undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  price?: number;

  @ValidateIf((dto: SetCustomerPriceDto) => dto.price === undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  discountPercent?: number;
}
