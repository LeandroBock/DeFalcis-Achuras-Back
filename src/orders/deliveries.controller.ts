import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { isDateString, isUUID } from 'class-validator';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
import { UserRole } from '../users/entities/user.entity.js';

import {
  DeliveriesService,
  todayInBusinessTimezone,
} from './deliveries.service.js';
import { SetRouteDto } from './dto/set-route.dto.js';

const OFFICE = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS];

@ApiBearerAuth()
@Controller('deliveries')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DeliveriesController {
  constructor(private readonly deliveriesService: DeliveriesService) {}

  // Repartidores disponibles para asignar notas.
  @Get('drivers')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VENTAS)
  drivers() {
    return this.deliveriesService.drivers();
  }

  // Notas pendientes del repartidor que consulta (?date=AAAA-MM-DD opcional).
  @Get('mine')
  @Roles(UserRole.REPARTO, UserRole.SUPER_ADMIN, UserRole.ADMIN)
  mine(@CurrentUser() user: AuthUser, @Query('date') date?: string) {
    if (date !== undefined && !isDateString(date, { strict: true })) {
      throw new BadRequestException(
        'La fecha debe tener el formato AAAA-MM-DD',
      );
    }

    return this.deliveriesService.pendingFor(user.sub, date);
  }

  // Notas pendientes de un repartidor en el orden de su ruta, para que la
  // oficina la arme (?date=AAAA-MM-DD opcional).
  @Get('route')
  @Roles(...OFFICE)
  route(@Query('driverId') driverId?: string, @Query('date') date?: string) {
    if (!driverId || !isUUID(driverId)) {
      throw new BadRequestException('Elegí un repartidor');
    }

    if (date !== undefined && !isDateString(date, { strict: true })) {
      throw new BadRequestException(
        'La fecha debe tener el formato AAAA-MM-DD',
      );
    }

    return this.deliveriesService.pendingFor(driverId, date);
  }

  @Put('route')
  @Roles(...OFFICE)
  setRoute(@Body() dto: SetRouteDto) {
    return this.deliveriesService.setRoute(dto.driverId, dto.orderIds);
  }

  // Una nota con todo lo necesario para cargar su entrega.
  @Get('orders/:id')
  @Roles(...OFFICE)
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.deliveriesService.detail(id);
  }

  // Tablero del día (por defecto, hoy) para seguir el reparto en vivo.
  @Get('board')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.VENTAS,
    UserRole.FINANZAS,
  )
  board(@Query('date') date?: string) {
    if (date !== undefined && !isDateString(date, { strict: true })) {
      throw new BadRequestException(
        'La fecha debe tener el formato AAAA-MM-DD',
      );
    }

    return this.deliveriesService.board(date ?? todayInBusinessTimezone());
  }

  // Rendición de un repartidor en un día (por defecto, hoy). Un repartidor
  // solo puede ver la suya.
  @Get('settlement')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.FINANZAS,
    UserRole.REPARTO,
  )
  settlement(
    @CurrentUser() user: AuthUser,
    @Query('userId') userId?: string,
    @Query('date') date?: string,
  ) {
    const driverId = userId ?? user.sub;

    if (!isUUID(driverId)) {
      throw new BadRequestException('Repartidor inválido');
    }

    if (date !== undefined && !isDateString(date, { strict: true })) {
      throw new BadRequestException(
        'La fecha debe tener el formato AAAA-MM-DD',
      );
    }

    if (user.role === UserRole.REPARTO && driverId !== user.sub) {
      throw new ForbiddenException('Solo podés ver tu propia rendición');
    }

    return this.deliveriesService.settlement(
      driverId,
      date ?? todayInBusinessTimezone(),
    );
  }
}
