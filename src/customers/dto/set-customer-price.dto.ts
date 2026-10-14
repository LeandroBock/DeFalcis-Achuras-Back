import { IsNumber, Min } from 'class-validator';

export class SetCustomerPriceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  price: number;
}
