import { EntityManager, IsNull, MoreThan } from 'typeorm';

import { UserSession } from './entities/user-session.entity.js';

// Duración máxima de una sesión (después hay que volver a ingresar).
export const DEFAULT_SESSION_HOURS = 8;

export function sessionHours(value: unknown) {
  const hours = Number(value);
  return Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_SESSION_HOURS;
}

// Cierra todas las sesiones abiertas de un usuario (por ejemplo, al
// resetearle la contraseña o bloquearlo: si perdió el celular, se corta).
export async function revokeUserSessions(
  manager: EntityManager,
  userId: string,
) {
  await manager
    .getRepository(UserSession)
    .update(
      { userId, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) },
      { revokedAt: new Date() },
    );
}
