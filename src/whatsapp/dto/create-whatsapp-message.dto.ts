import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateWhatsAppMessageDto {
  @IsString()
  @MinLength(8)
  @MaxLength(30)
  phone: string;

  @IsString()
  @MinLength(1)
  message: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  externalMessageId?: string;
}

export class AnalyzeWhatsAppMessageDto {
  @IsString()
  @MinLength(1)
  message: string;
}
