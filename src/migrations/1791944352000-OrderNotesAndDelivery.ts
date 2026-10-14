import { MigrationInterface, QueryRunner } from 'typeorm';

// Notas de pedido y reparto: la venta nace como nota (pendiente), el
// repartidor carga los kilos reales y lo cobrado, y recién ahí es venta.
export class OrderNotesAndDelivery1791944352000 implements MigrationInterface {
  name = 'OrderNotesAndDelivery1791944352000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "PAYMENTS" ADD "collectedById" uuid`);
    await queryRunner.query(`ALTER TABLE "ORDERS" ADD "assignedToId" uuid`);
    await queryRunner.query(`ALTER TABLE "ORDERS" ADD "deliveryDate" date`);
    await queryRunner.query(`ALTER TABLE "ORDERS" ADD "deliveredAt" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "ORDERS" ADD "deliveredById" uuid`);
    await queryRunner.query(`ALTER TABLE "ORDERS" ADD "deliveryComment" text`);
    await queryRunner.query(
      `ALTER TABLE "ORDER_ITEMS" ADD "requestedQuantity" numeric(12,3) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_PAYMENTS_collectedById" ON "PAYMENTS" ("collectedById")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ORDERS_assignedToId" ON "ORDERS" ("assignedToId")`,
    );

    // En los pedidos existentes lo pedido es lo que se registró.
    await queryRunner.query(
      `UPDATE "ORDER_ITEMS" SET "requestedQuantity" = quantity`,
    );

    // Hasta ahora un pedido confirmado ya era una venta hecha (con el stock
    // descontado): pasan a entregados para que los reportes no cambien.
    await queryRunner.query(`
      UPDATE "ORDERS"
      SET status = 'delivered', "deliveredAt" = "createdAt"
      WHERE status = 'confirmed'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "ORDERS" SET status = 'confirmed'
      WHERE status = 'delivered' AND "deliveredById" IS NULL
    `);
    await queryRunner.query(`DROP INDEX "public"."IDX_ORDERS_assignedToId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_PAYMENTS_collectedById"`);
    await queryRunner.query(
      `ALTER TABLE "ORDER_ITEMS" DROP COLUMN "requestedQuantity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ORDERS" DROP COLUMN "deliveryComment"`,
    );
    await queryRunner.query(`ALTER TABLE "ORDERS" DROP COLUMN "deliveredById"`);
    await queryRunner.query(`ALTER TABLE "ORDERS" DROP COLUMN "deliveredAt"`);
    await queryRunner.query(`ALTER TABLE "ORDERS" DROP COLUMN "deliveryDate"`);
    await queryRunner.query(`ALTER TABLE "ORDERS" DROP COLUMN "assignedToId"`);
    await queryRunner.query(
      `ALTER TABLE "PAYMENTS" DROP COLUMN "collectedById"`,
    );
  }
}
