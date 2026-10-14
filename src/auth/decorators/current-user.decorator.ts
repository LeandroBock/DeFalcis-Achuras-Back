import { ExecutionContext, createParamDecorator } from '@nestjs/common';

import { UserRole } from '../../users/entities/user.entity.js';

// Usuario autenticado (lo deja JwtAuthGuard en request.user).
// sid: sesión del login (ver UserSession).
export type AuthUser = {
  sub: string;
  email: string;
  role: UserRole;
  sid: string;
};

export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthUser =>
    context.switchToHttp().getRequest().user,
);
