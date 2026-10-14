import { MigrationInterface, QueryRunner } from 'typeorm';

// Sesiones de login con duración máxima y revocación (cerrar sesión, resetear
// contraseña o bloquear al usuario cortan el token al instante).
export class UserSessions1791986794000 implements MigrationInterface {
  name = 'UserSessions1791986794000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "USER_SESSIONS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "expiresAt" TIMESTAMP NOT NULL, "revokedAt" TIMESTAMP, "userAgent" character varying(255), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_14203b430798848279a2f3e2226" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_USER_SESSIONS_userId" ON "USER_SESSIONS" ("userId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_USER_SESSIONS_userId"`);
    await queryRunner.query(`DROP TABLE "USER_SESSIONS"`);
  }
}
