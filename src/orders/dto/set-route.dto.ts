import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

// Orden de las paradas de un repartidor, de la primera a la última.
export class SetRouteDto {
  @IsUUID()
  driverId: string;

  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  orderIds: string[];
}
