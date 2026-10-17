import { MigrationInterface, QueryRunner } from 'typeorm';

// Listas de precios (con clientes asignados), descuentos por producto sobre
// la lista, deuda opcional por cliente, orden de la ruta de cada repartidor y
// recibo X de cada entrega.
export class PriceListsRoutesReceipts1792100000000 implements MigrationInterface {
  name = 'PriceListsRoutesReceipts1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "PRICE_LISTS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "adjustmentPercent" numeric(6,2) NOT NULL DEFAULT '0', "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_PRICE_LISTS_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "PRICE_LIST_ITEMS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "priceListId" uuid NOT NULL, "productId" uuid NOT NULL, "price" numeric(12,2) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_PRICE_LIST_ITEMS_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_PRICE_LIST_ITEMS_list_product" ON "PRICE_LIST_ITEMS" ("priceListId", "productId")`,
    );

    // Hasta ahora a todos los clientes se les mostraba la deuda en las
    // entregas; desde acá solo a los que tengan el tilde.
    await queryRunner.query(
      `ALTER TABLE "CUSTOMERS" ADD "priceListId" uuid, ADD "collectDebt" boolean NOT NULL DEFAULT false`,
    );

    // Un precio especial puede ser un monto fijo (como hasta ahora) o un
    // porcentaje de descuento sobre el precio de su lista.
    await queryRunner.query(
      `ALTER TABLE "CUSTOMER_PRICES" ALTER COLUMN "price" DROP NOT NULL, ADD "discountPercent" numeric(5,2)`,
    );

    await queryRunner.query(
      `ALTER TABLE "ORDERS" ADD "routeOrder" integer, ADD "receiptNumber" integer, ADD "debtCollected" numeric(12,2) NOT NULL DEFAULT '0', ADD "receiptSentAt" TIMESTAMP, ADD "receiptError" text`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_ORDERS_receiptNumber" ON "ORDERS" ("receiptNumber") WHERE "receiptNumber" IS NOT NULL`,
    );
    await queryRunner.query(`CREATE SEQUENCE "ORDER_RECEIPT_SEQ"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP SEQUENCE "ORDER_RECEIPT_SEQ"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_ORDERS_receiptNumber"`);
    await queryRunner.query(
      `ALTER TABLE "ORDERS" DROP COLUMN "receiptError", DROP COLUMN "receiptSentAt", DROP COLUMN "debtCollected", DROP COLUMN "receiptNumber", DROP COLUMN "routeOrder"`,
    );
    await queryRunner.query(
      `DELETE FROM "CUSTOMER_PRICES" WHERE "price" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "CUSTOMER_PRICES" DROP COLUMN "discountPercent", ALTER COLUMN "price" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "CUSTOMERS" DROP COLUMN "collectDebt", DROP COLUMN "priceListId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_PRICE_LIST_ITEMS_list_product"`,
    );
    await queryRunner.query(`DROP TABLE "PRICE_LIST_ITEMS"`);
    await queryRunner.query(`DROP TABLE "PRICE_LISTS"`);
  }
}
