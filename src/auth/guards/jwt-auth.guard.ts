import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';

import { User } from '../../users/entities/user.entity.js';
import { UserSession } from '../entities/user-session.entity.js';
import { ALLOW_QUERY_TOKEN_KEY } from '../decorators/allow-query-token.decorator.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const token = this.extractToken(context, request);

    let payload: { sub: string; email: string; role: string; sid?: string };

    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Tu sesión venció. Volvé a ingresar.');
    }

    // Tokens anteriores a las sesiones (sin sid): hay que volver a ingresar.
    if (!payload.sid) {
      throw new UnauthorizedException('Tu sesión venció. Volvé a ingresar.');
    }

    // Estado actual del usuario y de la sesión, en una sola consulta: el token
    // puede seguir vigente aunque el usuario haya sido desactivado, le hayan
    // cambiado el rol o haya cerrado la sesión.
    const row = await this.dataSource
      .getRepository(User)
      .createQueryBuilder('u')
      .innerJoin(UserSession, 's', 's.userId = u.id AND s.id = :sid', {
        sid: payload.sid,
      })
      .select('u.email', 'email')
      .addSelect('u.role', 'role')
      .addSelect('u.isActive', 'isActive')
      .addSelect('s.revokedAt', 'revokedAt')
      .addSelect('s.expiresAt', 'expiresAt')
      .where('u.id = :id', { id: payload.sub })
      .getRawOne<{
        email: string;
        role: string;
        isActive: boolean;
        revokedAt: Date | null;
        expiresAt: Date;
      }>();

    if (!row || !row.isActive) {
      throw new UnauthorizedException('Usuario inexistente o desactivado');
    }

    if (row.revokedAt || new Date(row.expiresAt) <= new Date()) {
      throw new UnauthorizedException('Tu sesión se cerró. Volvé a ingresar.');
    }

    request.user = {
      ...payload,
      email: row.email,
      role: row.role,
    };

    return true;
  }

  private extractToken(
    context: ExecutionContext,
    request: {
      headers: { authorization?: string };
      query?: { access_token?: unknown };
    },
  ) {
    const authorization = request.headers.authorization;

    if (authorization) {
      const [type, token] = authorization.split(' ');

      if (type !== 'Bearer' || !token) {
        throw new UnauthorizedException('Formato de token inválido');
      }

      return token;
    }

    const allowQueryToken = this.reflector.getAllAndOverride<boolean>(
      ALLOW_QUERY_TOKEN_KEY,
      [context.getHandler(), context.getClass()],
    );
    const queryToken = request.query?.access_token;

    if (allowQueryToken && typeof queryToken === 'string' && queryToken) {
      return queryToken;
    }

    throw new UnauthorizedException('Token no proporcionado');
  }
}
