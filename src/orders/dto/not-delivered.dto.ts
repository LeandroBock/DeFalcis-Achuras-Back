import { IsString, MinLength } from 'class-validator';

export class NotDeliveredDto {
  // Por qué no se entregó (no estaba, no lo quiso, etc.).
  @IsString()
  @MinLength(1)
  reason: string;
}
