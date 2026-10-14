import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class SendWhatsAppMessageDto {
  @ApiProperty({ example: 'Hola Juan, ¿cuántos kilos querés?' })
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  message: string;
}
