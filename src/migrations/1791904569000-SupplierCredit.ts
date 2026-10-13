import { MigrationInterface, QueryRunner } from 'typeorm';

// 1. Agrega el método de pago 'supplier_credit' (saldo a favor del proveedor).
// 2. Registra el pago de las compras de contado existentes, que hasta ahora
//    quedaban como pagadas sin ningún pago asociado.
export class SupplierCredit1791904569000 implements MigrationInterface {
  name = 'SupplierCredit1791904569000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ udt_name: methodEnum }] = await queryRunner.query(`
      SELECT udt_name
      FROM information_schema.columns
      WHERE table_name = 'SUPPLIER_PAYMENTS' AND column_name = 'method'
    `);

    await queryRunner.query(
      `ALTER TYPE "${methodEnum}" ADD VALUE IF NOT EXISTS 'supplier_credit'`,
    );

    await queryRunner.query(`
      INSERT INTO "SUPPLIER_PAYMENTS" ("purchaseId", amount, method, notes, "createdAt")
      SELECT p.id, p.total, p."paymentMethod"::text::"${methodEnum}",
             'Pago al registrar la compra', p."createdAt"
      FROM "PURCHASES" p
      WHERE p."paymentMethod"::text <> 'credit'
        AND p."paymentStatus"::text <> 'cancelled'
        AND p.total > 0
        AND NOT EXISTS (
          SELECT 1 FROM "SUPPLIER_PAYMENTS" sp WHERE sp."purchaseId" = p.id
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres no permite quitar valores de un enum; solo se revierten los
    // pagos generados automáticamente por esta migración.
    await queryRunner.query(`
      DELETE FROM "SUPPLIER_PAYMENTS"
      WHERE notes = 'Pago al registrar la compra'
        AND method::text <> 'supplier_credit'
    `);
  }
}
