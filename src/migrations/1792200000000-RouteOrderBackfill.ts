import { MigrationInterface, QueryRunner } from 'typeorm';

// Las notas que ya estaban asignadas antes de las rutas no tenían posición:
// una nota nueva quedaba primera en vez de última. Se numeran todas las
// pendientes de cada repartidor (las que ya tenían orden primero, después
// las demás por fecha de entrega y de creación).
export class RouteOrderBackfill1792200000000 implements MigrationInterface {
  name = 'RouteOrderBackfill1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "ORDERS" o
      SET "routeOrder" = numbered.position
      FROM (
        SELECT "id", ROW_NUMBER() OVER (
          PARTITION BY "assignedToId"
          ORDER BY "routeOrder" ASC NULLS LAST,
                   "deliveryDate" ASC NULLS LAST,
                   "createdAt" ASC
        ) AS position
        FROM "ORDERS"
        WHERE "status" = 'pending' AND "assignedToId" IS NOT NULL
      ) numbered
      WHERE o."id" = numbered."id"
    `);
  }

  public async down(): Promise<void> {
    // Solo numera notas existentes: no hay nada que deshacer.
  }
}
