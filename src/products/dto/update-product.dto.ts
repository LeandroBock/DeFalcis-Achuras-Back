import { IsEnum, IsNumber, IsOptional, IsString, Max } from 'class-validator';
import { ProductUnit } from '../entities/product.entity.js';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsEnum(ProductUnit)
  unit?: ProductUnit;

  @IsOptional()
  @IsNumber()
  @Max(9999999)
  salePrice?: number;

  @IsOptional()
  @IsNumber()
  @Max(9999999)
  costPrice?: number;

  @IsOptional()
  @IsNumber()
  @Max(9999999)
  stock?: number;
}
