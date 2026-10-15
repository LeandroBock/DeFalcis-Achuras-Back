import { MigrationInterface, QueryRunner } from 'typeorm';

// Datos del cliente tal como se facturaron (si después se edita el cliente,
// el PDF de la factura no cambia) y el estado del envío por mail.
export class InvoiceDetails1792000000000 implements MigrationInterface {
  name = 'InvoiceDetails1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "INVOICES" ADD "customerName" character varying(150), ADD "customerAddress" text, ADD "customerEmail" character varying(150), ADD "emailedTo" character varying(150), ADD "emailedAt" TIMESTAMP, ADD "emailError" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "INVOICES" DROP COLUMN "emailError", DROP COLUMN "emailedAt", DROP COLUMN "emailedTo", DROP COLUMN "customerEmail", DROP COLUMN "customerAddress", DROP COLUMN "customerName"`,
    );
  }
}
