import { MigrationInterface, QueryRunner } from 'typeorm';

// Vincula cada empleado con su usuario de la app (por ejemplo, un repartidor).
export class EmployeeAccounts1791946933000 implements MigrationInterface {
  name = 'EmployeeAccounts1791946933000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "EMPLOYEES" ADD "userId" uuid`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_EMPLOYEES_userId" ON "EMPLOYEES" ("userId") WHERE "userId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_EMPLOYEES_userId"`);
    await queryRunner.query(`ALTER TABLE "EMPLOYEES" DROP COLUMN "userId"`);
  }
}
