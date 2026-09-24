import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class PrepareWhatsAppOrderDto {
  @ApiProperty({
    example: '3415556789',
    description: 'Teléfono del cliente',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(30)
  phone: string;

  @ApiProperty({
    example: 'Hola, quiero 3 kg de chinchulines',
    description: 'Mensaje enviado por el cliente',
  })
  @IsString()
  @MinLength(1)
  message: string;
}
