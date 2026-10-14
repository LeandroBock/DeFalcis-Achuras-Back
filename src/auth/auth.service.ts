import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import * as bcrypt from 'bcrypt';

import { JwtService } from '@nestjs/jwt';

import { UsersService } from '../users/users.service.js';
import { LoginDto } from './dto/login.dto.js';
import { UserSession } from './entities/user-session.entity.js';
import { sessionHours } from './sessions.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,

    @InjectRepository(UserSession)
    private readonly sessionsRepository: Repository<UserSession>,
  ) {}

  async login(loginDto: LoginDto, userAgent?: string) {
    const user = await this.usersService.findByEmailWithPassword(
      loginDto.email,
    );

    if (!user) {
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    const passwordIsValid = await bcrypt.compare(
      loginDto.password,
      user.password,
    );

    if (!passwordIsValid) {
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('El usuario está desactivado');
    }

    // Cada ingreso es una sesión de duración limitada (SESSION_HOURS,
    // 8 horas por defecto).
    const hours = sessionHours(this.config.get('SESSION_HOURS'));
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    const session = await this.sessionsRepository.save(
      this.sessionsRepository.create({
        userId: user.id,
        expiresAt,
        userAgent: userAgent?.slice(0, 255) ?? null,
      }),
    );

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      sid: session.id,
    };

    const token = await this.jwtService.signAsync(payload, {
      expiresIn: hours * 60 * 60,
    });

    return {
      access_token: token,
      expiresAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }

  // Cerrar sesión: el token deja de servir aunque no haya vencido.
  async logout(sessionId: string) {
    await this.sessionsRepository.update(
      { id: sessionId },
      { revokedAt: new Date() },
    );

    return { message: 'Sesión cerrada' };
  }
}
