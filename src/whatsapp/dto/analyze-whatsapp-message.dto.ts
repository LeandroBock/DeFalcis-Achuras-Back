import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class AnalyzeWhatsAppMessageDto {
  @ApiProperty({
    example: 'Hola, quiero 3 kg de chinchulines',
    description: 'Mensaje recibido del cliente por WhatsApp',
  })
  @IsString()
  @MinLength(1)
  message: string;
}
