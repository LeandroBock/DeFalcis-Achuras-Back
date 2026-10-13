import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';

import { User } from '../../users/entities/user.entity.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const authorization = request.headers.authorization;

    if (!authorization) {
      throw new UnauthorizedException('Token no proporcionado');
    }

    const [type, token] = authorization.split(' ');

    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Formato de token inválido');
    }

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
}
