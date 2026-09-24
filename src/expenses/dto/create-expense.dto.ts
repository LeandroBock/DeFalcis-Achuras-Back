import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

import {
  ExpenseCategory,
  ExpensePaymentMethod,
} from '../entities/expense.entity.js';

export class CreateExpenseDto {
  @IsEnum(ExpenseCategory)
  category: ExpenseCategory;

  @IsNotEmpty()
  @IsString()
  description: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsEnum(ExpensePaymentMethod)
  paymentMethod: ExpensePaymentMethod;

  @IsOptional()
  @IsString()
  notes?: string;
}
