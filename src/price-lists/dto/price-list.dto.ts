import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePriceListDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

  // Ajuste sobre el precio normal para los productos sin precio fijo en la
  // lista: -10 = 10% menos, 5 = 5% más.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-99.99)
  @Max(999.99)
  adjustmentPercent?: number;
}

export class UpdatePriceListDto {
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-99.99)
  @Max(999.99)
  adjustmentPercent?: number;
}

export class SetPriceListItemDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9999999)
  price: number;
}

// Clientes que se cobran con la lista. Los que estaban y no vienen quedan
// sin lista (precio normal).
export class SetPriceListCustomersDto {
  @IsArray()
  @IsUUID('all', { each: true })
  customerIds: string[];
}
