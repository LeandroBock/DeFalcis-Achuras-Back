import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // Tilde: mostrar y cobrar su deuda de cuenta corriente en las entregas.
  @IsOptional()
  @IsBoolean()
  collectDebt?: boolean;

  // Lista de precios que se le cobra (null para el precio normal).
  @ValidateIf((dto: { priceListId?: string | null }) => !!dto.priceListId)
  @IsUUID()
  priceListId?: string | null;
}
