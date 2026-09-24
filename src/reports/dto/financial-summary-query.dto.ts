import { IsDateString, IsOptional } from 'class-validator';

export class FinancialSummaryQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
