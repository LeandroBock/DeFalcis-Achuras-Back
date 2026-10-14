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

    let payload: { sub: string; email: string; role: string };

    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    // El token puede seguir vigente aunque el usuario haya sido desactivado
    // o le hayan cambiado el rol: se toma el estado actual de la base.
    const user = await this.dataSource.getRepository(User).findOne({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Usuario inexistente o desactivado');
    }

    request.user = { ...payload, email: user.email, role: user.role };

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
