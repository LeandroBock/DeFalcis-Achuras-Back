import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
} from 'class-validator';

import { ProductUnit } from '../entities/product.entity.js';

export class CreateProductDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNotEmpty()
  @IsString()
  category: string;

  @IsEnum(ProductUnit)
  unit: ProductUnit;

  @IsNumber()
  @Max(9999999)
  salePrice: number;

  @IsNumber()
  @Max(9999999)
  costPrice: number;

  @IsOptional()
  @IsNumber()
  @Max(9999999)
  stock?: number;
}
