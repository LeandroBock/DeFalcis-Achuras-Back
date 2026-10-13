import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { UserRole } from '../../users/entities/user.entity.js';

import { RolesGuard } from './roles.guard.js';

describe('RolesGuard', () => {
  const contextFor = (user?: { role: UserRole }) =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const guardRequiring = (roles?: UserRole[]) => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles);
    return new RolesGuard(reflector);
  };

  it('deja pasar si la ruta no exige roles', () => {
    expect(guardRequiring(undefined).canActivate(contextFor())).toBe(true);
  });

  it('deja pasar si el usuario tiene uno de los roles', () => {
    const guard = guardRequiring([UserRole.ADMIN, UserRole.FINANZAS]);

    expect(guard.canActivate(contextFor({ role: UserRole.FINANZAS }))).toBe(
      true,
    );
  });

  it('rechaza si el usuario no tiene ninguno de los roles', () => {
    const guard = guardRequiring([UserRole.SUPER_ADMIN]);

    expect(() =>
      guard.canActivate(contextFor({ role: UserRole.ADMIN })),
    ).toThrow(ForbiddenException);
  });

  it('rechaza si no hay usuario autenticado', () => {
    const guard = guardRequiring([UserRole.ADMIN]);

    expect(() => guard.canActivate(contextFor())).toThrow(ForbiddenException);
  });
});
