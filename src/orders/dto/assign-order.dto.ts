import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsUUID,
  ValidateIf,
} from 'class-validator';

export class AssignOrderDto {
  // null para desasignar.
  @ValidateIf((dto: AssignOrderDto) => dto.assignedToId !== null)
  @IsUUID()
  assignedToId: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  deliveryDate?: string;
}

// Asignar varias notas pendientes al mismo repartidor (o desasignarlas).
export class BulkAssignOrdersDto extends AssignOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  orderIds: string[];
}
