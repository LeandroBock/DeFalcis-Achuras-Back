import { MigrationInterface, QueryRunner } from 'typeorm';

// Conexión real con WhatsApp: tabla para la sesión, nombre del contacto en
// los mensajes y un índice único para no guardar dos veces el mismo mensaje.
export class WhatsAppConnection1791937082000 implements MigrationInterface {
  name = 'WhatsAppConnection1791937082000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "WHATSAPP_AUTH" ("id" character varying(255) NOT NULL, "data" text NOT NULL, "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6fec2f5e8a32497c71fdda502f6" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `ALTER TABLE "WHATSAPP_MESSAGES" ADD "contactName" character varying(100)`,
    );

    // Si ya hubiera ids externos repetidos (cargados a mano), se conserva el
    // primero y a los demás se les quita el id, para poder crear el índice.
    await queryRunner.query(`
      UPDATE "WHATSAPP_MESSAGES" m SET "externalMessageId" = NULL
      WHERE "externalMessageId" IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM "WHATSAPP_MESSAGES" other
          WHERE other."externalMessageId" = m."externalMessageId"
            AND (other."createdAt", other.id) < (m."createdAt", m.id)
        )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_WHATSAPP_MESSAGES_externalMessageId" ON "WHATSAPP_MESSAGES" ("externalMessageId") WHERE "externalMessageId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."UQ_WHATSAPP_MESSAGES_externalMessageId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WHATSAPP_MESSAGES" DROP COLUMN "contactName"`,
    );
    await queryRunner.query(`DROP TABLE "WHATSAPP_AUTH"`);
  }
}
