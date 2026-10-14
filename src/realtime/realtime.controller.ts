import { Controller, MessageEvent, Sse, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Observable, interval, map, merge } from 'rxjs';

import { AllowQueryToken } from '../auth/decorators/allow-query-token.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { UserRole } from '../users/entities/user.entity.js';

import { RealtimeService } from './realtime.service.js';

// Evento vacío periódico para que el proxy de Render no corte la conexión.
const HEARTBEAT_MS = 25_000;

@ApiBearerAuth()
@Controller('events')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  // Server-Sent Events para la oficina. Desde el navegador:
  //   new EventSource(`${API}/events?access_token=${token}`)
  @Sse()
  @AllowQueryToken()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.VENTAS,
    UserRole.FINANZAS,
  )
  stream(): Observable<MessageEvent> {
    return merge(
      this.realtime.orders().pipe(map(({ type, data }) => ({ type, data }))),
      interval(HEARTBEAT_MS).pipe(map(() => ({ type: 'ping', data: {} }))),
    );
  }
}
