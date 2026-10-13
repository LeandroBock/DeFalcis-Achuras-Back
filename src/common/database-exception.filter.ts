import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  HttpException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';

// Códigos de error de Postgres que son errores del cliente, no del servidor.
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const INVALID_TEXT_REPRESENTATION = '22P02';

// Nombre para mostrar de las columnas con restricción única.
const COLUMN_LABEL: Record<string, string> = {
  email: 'email',
  phone: 'teléfono',
  name: 'nombre',
  orderId: 'pedido',
};

// Traduce las restricciones de la base (por ejemplo, un email repetido) a
// respuestas 4xx claras. Cualquier otro error sigue el manejo estándar de
// Nest: 500 sin detalles internos y el error completo en el log.
@Catch(QueryFailedError)
export class DatabaseExceptionFilter extends BaseExceptionFilter {
  catch(exception: QueryFailedError, host: ArgumentsHost) {
    const mapped = this.toHttpException(exception);

    super.catch(mapped ?? exception, host);
  }

  private toHttpException(exception: QueryFailedError): HttpException | null {
    const { code, detail } = exception.driverError as {
      code?: string;
      detail?: string;
    };

    if (code === UNIQUE_VIOLATION) {
      // detail: 'Key (email)=(x@y.com) already exists.'
      const column = detail?.match(/^Key \("?([^)"]+)"?\)=/)?.[1];

      return new ConflictException(
        column
          ? `Ya existe un registro con ese ${COLUMN_LABEL[column] ?? column}`
          : 'Ya existe un registro con esos datos',
      );
    }

    if (code === FOREIGN_KEY_VIOLATION) {
      return new ConflictException(
        'La operación no es posible porque el registro está relacionado con otros datos',
      );
    }

    if (code === INVALID_TEXT_REPRESENTATION) {
      return new BadRequestException(
        'Alguno de los valores enviados es inválido',
      );
    }

    return null;
  }
}
