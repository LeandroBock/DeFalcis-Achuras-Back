import { MigrationInterface, QueryRunner } from 'typeorm';

// Índices para las columnas por las que se cruzan tablas (pagos de un pedido,
// ítems de una compra, etc.) y por las que se filtra por fecha en reportes.
// Deben coincidir con los @Index declarados en las entidades.
const INDEXES: [table: string, column: string][] = [
  ['PAYMENTS', 'orderId'],
  ['SUPPLIER_PAYMENTS', 'purchaseId'],
  ['ORDER_ITEMS', 'orderId'],
  ['PURCHASE_ITEMS', 'purchaseId'],
  ['INVENTORY_MOVEMENTS', 'productId'],
  ['WHATSAPP_MESSAGES', 'phone'],
  ['ORDERS', 'createdAt'],
  ['PURCHASES', 'createdAt'],
  ['PURCHASES', 'supplierId'],
  ['EXPENSES', 'createdAt'],
];

export class ReportIndexes1791905444000 implements MigrationInterface {
  name = 'ReportIndexes1791905444000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of INDEXES) {
      await queryRunner.query(
        `CREATE INDEX IF NOT EXISTS "IDX_${table}_${column}" ON "${table}" ("${column}")`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, column] of INDEXES) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_${table}_${column}"`);
    }
  }
}
