import { MigrationInterface, QueryRunner } from 'typeorm';

// Esquema completo de la base. Hasta esta migración las tablas se creaban con
// synchronize, así que:
// - en una base vacía (entorno nuevo, tests, recuperación) crea todo;
// - en una base existente (como la de producción) no hace nada.
// Las migraciones siguientes son idempotentes sobre este esquema.
const SCHEMA: string[] = [
  'CREATE TYPE "public"."WHATSAPP_MESSAGES_direction_enum" AS ENUM(\'incoming\', \'outgoing\')',
  "CREATE TYPE \"public\".\"WHATSAPP_MESSAGES_type_enum\" AS ENUM('text', 'image', 'audio', 'document', 'other')",
  "CREATE TYPE \"public\".\"WHATSAPP_MESSAGES_status_enum\" AS ENUM('received', 'sent', 'failed')",
  'CREATE TABLE "WHATSAPP_MESSAGES" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "phone" character varying(30) NOT NULL, "direction" "public"."WHATSAPP_MESSAGES_direction_enum" NOT NULL, "type" "public"."WHATSAPP_MESSAGES_type_enum" NOT NULL DEFAULT \'text\', "message" text, "customerId" uuid, "externalMessageId" character varying(150), "status" "public"."WHATSAPP_MESSAGES_status_enum" NOT NULL DEFAULT \'received\', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_8c59ff76d1b64983949fd5fe656" PRIMARY KEY ("id"))',
  'CREATE INDEX "IDX_WHATSAPP_MESSAGES_phone" ON "WHATSAPP_MESSAGES"  ("phone") ',
  "CREATE TYPE \"public\".\"WHATSAPP_ORDERS_status_enum\" AS ENUM('pending', 'confirmed', 'cancelled')",
  'CREATE TABLE "WHATSAPP_ORDERS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "phone" character varying(30) NOT NULL, "customerId" uuid, "orderId" uuid, "productId" uuid NOT NULL, "quantity" numeric(12,3) NOT NULL, "unit" character varying(10) NOT NULL, "unitPrice" numeric(12,2) NOT NULL, "subtotal" numeric(12,2) NOT NULL, "status" "public"."WHATSAPP_ORDERS_status_enum" NOT NULL DEFAULT \'pending\', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_4472b1bd6a3a2a957efa73ed266" PRIMARY KEY ("id"))',
  "CREATE TYPE \"public\".\"USERS_role_enum\" AS ENUM('super_admin', 'admin', 'ventas', 'deposito', 'reparto', 'finanzas')",
  'CREATE TABLE "USERS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "email" character varying(150) NOT NULL, "password" character varying NOT NULL, "role" "public"."USERS_role_enum" NOT NULL DEFAULT \'ventas\', "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_a1689164dbbcca860ce6d17b2e1" UNIQUE ("email"), CONSTRAINT "PK_b16c39a00c89083529c6166fa5b" PRIMARY KEY ("id"))',
  'CREATE TABLE "SUPPLIERS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "contactName" character varying(100), "phone" character varying(30), "email" character varying(150), "address" text, "notes" text, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_2c44b4fc7b0963511f5a49443d0" UNIQUE ("phone"), CONSTRAINT "UQ_234c9090624522326e82ad1599a" UNIQUE ("email"), CONSTRAINT "PK_d121a0eb636c8ce1d3ced60d922" PRIMARY KEY ("id"))',
  "CREATE TYPE \"public\".\"SUPPLIER_PAYMENTS_method_enum\" AS ENUM('cash', 'transfer', 'mercado_pago', 'supplier_credit')",
  'CREATE TABLE "SUPPLIER_PAYMENTS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "purchaseId" uuid NOT NULL, "amount" numeric(12,2) NOT NULL, "method" "public"."SUPPLIER_PAYMENTS_method_enum" NOT NULL, "notes" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_85ba0d969faf598838ee7cdeeea" PRIMARY KEY ("id"))',
  'CREATE INDEX "IDX_SUPPLIER_PAYMENTS_purchaseId" ON "SUPPLIER_PAYMENTS"  ("purchaseId") ',
  "CREATE TYPE \"public\".\"PURCHASES_paymentmethod_enum\" AS ENUM('cash', 'transfer', 'mercado_pago', 'credit')",
  "CREATE TYPE \"public\".\"PURCHASES_paymentstatus_enum\" AS ENUM('pending', 'partial', 'paid', 'cancelled')",
  'CREATE TABLE "PURCHASES" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "supplierId" uuid NOT NULL, "paymentMethod" "public"."PURCHASES_paymentmethod_enum" NOT NULL, "paymentStatus" "public"."PURCHASES_paymentstatus_enum" NOT NULL DEFAULT \'pending\', "total" numeric(12,2) NOT NULL DEFAULT \'0\', "notes" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_68213523f5d566e85843ac32fff" PRIMARY KEY ("id"))',
  'CREATE INDEX "IDX_PURCHASES_supplierId" ON "PURCHASES"  ("supplierId") ',
  'CREATE INDEX "IDX_PURCHASES_createdAt" ON "PURCHASES"  ("createdAt") ',
  'CREATE TABLE "PURCHASE_ITEMS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "purchaseId" uuid NOT NULL, "productId" uuid NOT NULL, "quantity" numeric(12,3) NOT NULL, "unitCost" numeric(12,2) NOT NULL, "subtotal" numeric(12,2) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_323571d9480744f3fb7fb085885" PRIMARY KEY ("id"))',
  'CREATE INDEX "IDX_PURCHASE_ITEMS_purchaseId" ON "PURCHASE_ITEMS"  ("purchaseId") ',
  'CREATE TYPE "public"."PRODUCTS_unit_enum" AS ENUM(\'kg\', \'unit\')',
  'CREATE TABLE "PRODUCTS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "description" text, "unit" "public"."PRODUCTS_unit_enum" NOT NULL, "salePrice" numeric(10,2) NOT NULL, "costPrice" numeric(10,2) NOT NULL, "stock" numeric(10,3) NOT NULL DEFAULT \'0\', "isActive" boolean NOT NULL DEFAULT true, "category" character varying(50) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "vatRate" numeric(5,2) NOT NULL DEFAULT \'21\', CONSTRAINT "PK_2fe88715843405b725ad16c32fc" PRIMARY KEY ("id"))',
  "CREATE TYPE \"public\".\"PAYMENTS_method_enum\" AS ENUM('cash', 'transfer', 'mercado_pago')",
  'CREATE TABLE "PAYMENTS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "orderId" uuid NOT NULL, "amount" numeric(12,2) NOT NULL, "method" "public"."PAYMENTS_method_enum" NOT NULL, "notes" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_63957ecf975f10c3444bddb418b" PRIMARY KEY ("id"))',
  'CREATE INDEX "IDX_PAYMENTS_orderId" ON "PAYMENTS"  ("orderId") ',
  "CREATE TYPE \"public\".\"ORDERS_status_enum\" AS ENUM('pending', 'confirmed', 'delivered', 'cancelled')",
  "CREATE TYPE \"public\".\"ORDERS_paymentstatus_enum\" AS ENUM('pending', 'partial', 'paid')",
  'CREATE TABLE "ORDERS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "customerId" uuid NOT NULL, "status" "public"."ORDERS_status_enum" NOT NULL DEFAULT \'pending\', "paymentStatus" "public"."ORDERS_paymentstatus_enum" NOT NULL DEFAULT \'pending\', "total" numeric(12,2) NOT NULL DEFAULT \'0\', "notes" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_10fbdf1c66850a0f61afcf552d9" PRIMARY KEY ("id"))',
  'CREATE INDEX "IDX_ORDERS_createdAt" ON "ORDERS"  ("createdAt") ',
  'CREATE TABLE "ORDER_ITEMS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "orderId" uuid NOT NULL, "productId" uuid NOT NULL, "quantity" numeric(12,3) NOT NULL, "unitPrice" numeric(12,2) NOT NULL, "subtotal" numeric(12,2) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6aab4ff2d155222cf382bae7546" PRIMARY KEY ("id"))',
  'CREATE INDEX "IDX_ORDER_ITEMS_orderId" ON "ORDER_ITEMS"  ("orderId") ',
  "CREATE TYPE \"public\".\"INVOICES_status_enum\" AS ENUM('pending', 'authorized', 'rejected')",
  'CREATE TABLE "INVOICES" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "orderId" uuid NOT NULL, "ptoVta" integer NOT NULL, "cbteTipo" integer NOT NULL, "cbteNro" integer, "status" "public"."INVOICES_status_enum" NOT NULL DEFAULT \'pending\', "cae" character varying(20), "caeVto" date, "cbteFch" date, "total" numeric(12,2) NOT NULL, "errorMessage" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "taxId" character varying(20), "taxCondition" integer NOT NULL DEFAULT \'5\', "netAmount" numeric(12,2) NOT NULL DEFAULT \'0\', "vatAmount" numeric(12,2) NOT NULL DEFAULT \'0\', CONSTRAINT "UQ_71a5cf100517b8ce9bf564d9e93" UNIQUE ("orderId"), CONSTRAINT "PK_ed2fb5586eabea92b53794168a7" PRIMARY KEY ("id"))',
  "CREATE TYPE \"public\".\"INVENTORY_MOVEMENTS_type_enum\" AS ENUM('entry', 'exit', 'adjustment')",
  'CREATE TABLE "INVENTORY_MOVEMENTS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "productId" uuid NOT NULL, "type" "public"."INVENTORY_MOVEMENTS_type_enum" NOT NULL, "quantity" numeric(12,3) NOT NULL, "reason" text, "referenceId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_81672a2d62b97671f36eb24b360" PRIMARY KEY ("id"))',
  'CREATE INDEX "IDX_INVENTORY_MOVEMENTS_productId" ON "INVENTORY_MOVEMENTS"  ("productId") ',
  "CREATE TYPE \"public\".\"EXPENSES_category_enum\" AS ENUM('rent', 'utilities', 'fuel', 'salaries', 'taxes', 'maintenance', 'administrative', 'other')",
  "CREATE TYPE \"public\".\"EXPENSES_paymentmethod_enum\" AS ENUM('cash', 'transfer', 'mercado_pago')",
  'CREATE TABLE "EXPENSES" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "category" "public"."EXPENSES_category_enum" NOT NULL, "description" character varying(150) NOT NULL, "amount" numeric(12,2) NOT NULL, "paymentMethod" "public"."EXPENSES_paymentmethod_enum" NOT NULL, "notes" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_893cda38f7647c1695f6e5c7122" PRIMARY KEY ("id"))',
  'CREATE INDEX "IDX_EXPENSES_createdAt" ON "EXPENSES"  ("createdAt") ',
  "CREATE TYPE \"public\".\"EMPLOYEES_position_enum\" AS ENUM('administration', 'sales', 'warehouse', 'delivery', 'production', 'other')",
  'CREATE TABLE "EMPLOYEES" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "phone" character varying(30), "email" character varying(150), "position" "public"."EMPLOYEES_position_enum" NOT NULL, "salary" numeric(12,2) NOT NULL DEFAULT \'0\', "isActive" boolean NOT NULL DEFAULT true, "notes" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_fda20b84c3b99f6ff7d6472be4d" PRIMARY KEY ("id"))',
  'CREATE TABLE "CUSTOMERS" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "phone" character varying(30), "email" character varying(150), "address" text, "notes" text, "taxId" character varying(20), "taxCondition" integer NOT NULL DEFAULT \'5\', "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_51fca5f5dac72a1f56cbd6480e9" PRIMARY KEY ("id"))',
  'CREATE TABLE "CATEGORIES" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(50) NOT NULL, "description" text, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_47c74bcf8ffb7df9a1525c23420" UNIQUE ("name"), CONSTRAINT "PK_fdcef262c7ee3ae985f62b3695f" PRIMARY KEY ("id"))',
];

export class InitialSchema1791900000000 implements MigrationInterface {
  name = 'InitialSchema1791900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('USERS')) {
      return;
    }

    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    for (const statement of SCHEMA) {
      await queryRunner.query(statement);
    }
  }

  public async down(): Promise<void> {
    // No se revierte: borraría todos los datos.
  }
}
