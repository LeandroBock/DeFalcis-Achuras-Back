import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Datos del cliente revisados antes de emitir (pueden corregirse en el
// momento).
export class BillingDataDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Falta el nombre o razón social del cliente' })
  @MaxLength(150)
  name: string;

  // CUIT o DNI; se aceptan guiones y puntos.
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  taxId?: string | null;

  @IsIn([1, 4, 5, 6], { message: 'Condición frente al IVA no válida' })
  taxCondition: number;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @IsOptional()
  @Transform(trim)
  @ValidateIf((_, value) => !!value)
  @IsEmail({}, { message: 'El mail del cliente no es válido' })
  @MaxLength(150)
  email?: string | null;
}

export class InvoicePreviewDto {
  @IsUUID()
  orderId: string;

  // Sin datos: se usan los del cliente.
  @IsOptional()
  @ValidateNested()
  @Type(() => BillingDataDto)
  customer?: BillingDataDto;
}

export class EmitInvoiceDto {
  @IsUUID()
  orderId: string;

  @ValidateNested()
  @Type(() => BillingDataDto)
  customer: BillingDataDto;

  // Guardar las correcciones en la ficha del cliente (por defecto, sí).
  @IsOptional()
  @IsBoolean()
  saveToCustomer?: boolean;

  // Mandar la factura por mail al emitirla (por defecto, sí).
  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;
}

export class SendInvoiceEmailDto {
  // Otro destinatario; si no, el mail con el que se facturó.
  @IsOptional()
  @Transform(trim)
  @ValidateIf((_, value) => !!value)
  @IsEmail({}, { message: 'El mail no es válido' })
  to?: string;
}
