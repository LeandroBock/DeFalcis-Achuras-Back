import { IsDateString, IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class AssignOrderDto {
  // null para desasignar.
  @ValidateIf((dto: AssignOrderDto) => dto.assignedToId !== null)
  @IsUUID()
  assignedToId: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  deliveryDate?: string;
}
