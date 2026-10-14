import { MigrationInterface, QueryRunner } from 'typeorm';

// Precios especiales por cliente (montos fijos por producto).
export class CustomerPrices1791948255000 implements MigrationInterface {
  name = 'CustomerPrices1791948255000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "CUSTOMER_PRICES" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "customerId" uuid NOT NULL, "productId" uuid NOT NULL, "price" numeric(12,2) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_14a1da5c5fc59cdbadf9e169964" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_CUSTOMER_PRICES_customer_product" ON "CUSTOMER_PRICES" ("customerId", "productId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."UQ_CUSTOMER_PRICES_customer_product"`,
    );
    await queryRunner.query(`DROP TABLE "CUSTOMER_PRICES"`);
  }
}
