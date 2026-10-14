import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './users/users.module.js';
import { AuthModule } from './auth/auth.module.js';
import { OnModuleInit } from '@nestjs/common';
import { UsersSeeder } from './users/seeders/users.seeder.js';
import { ProductsModule } from './products/products.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { SuppliersModule } from './suppliers/suppliers.module.js';
import { PurchasesModule } from './purchases/purchases.module.js';
import { PurchaseItemsModule } from './purchase-items/purchase-items.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { OrderItemsModule } from './order-items/order-items.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { ExpensesModule } from './expenses/expenses.module.js';
import { EmployeesModule } from './employee/employees.module.js';
import { SupplierPaymentsModule } from './supplier-payments/supplier-payments.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { WhatsAppModule } from './whatsapp/whatsapp.module.js';
import { InvoicingModule } from './invoicing/invoicing.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { validateEnv } from './config/env.validation.js';
import { arcaConfig } from './config/arca.config.js';
import { DatabaseExceptionFilter } from './common/database-exception.filter.js';
import { InitialSchema1791900000000 } from './migrations/1791900000000-InitialSchema.js';
import { SupplierCredit1791904569000 } from './migrations/1791904569000-SupplierCredit.js';
import { ReportIndexes1791905444000 } from './migrations/1791905444000-ReportIndexes.js';
import { WhatsAppConnection1791937082000 } from './migrations/1791937082000-WhatsAppConnection.js';
import { OrderNotesAndDelivery1791944352000 } from './migrations/1791944352000-OrderNotesAndDelivery.js';
import { EmployeeAccounts1791946933000 } from './migrations/1791946933000-EmployeeAccounts.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      load: [arcaConfig],
    }),

    // Límite global por IP: 100 requests por minuto.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],

      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST'),
        port: configService.get<number>('DB_PORT') || 5432, // Si falla, usa 5432 por defecto
        username: configService.get<string>('DB_USERNAME'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_NAME'),
        autoLoadEntities: true,
        synchronize: false, // 💡 Nota: se recomienda 'false' en producción para evitar pérdida de datos
        dropSchema: false,
        // Los cambios de esquema se hacen con migraciones (src/migrations) y
        // se aplican automáticamente al arrancar, una sola vez cada una.
        migrations: [
          InitialSchema1791900000000,
          SupplierCredit1791904569000,
          ReportIndexes1791905444000,
          WhatsAppConnection1791937082000,
          OrderNotesAndDelivery1791944352000,
          EmployeeAccounts1791946933000,
        ],
        migrationsRun: true,
        // Log de SQL solo en desarrollo.
        logging: !['production', 'test'].includes(
          configService.get<string>('NODE_ENV') ?? '',
        ),
        // ⚠️ ADVERTENCIA: Supabase exige SSL activo en servidores en la nube como Render
        ssl:
          process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      }),
    }),

    UsersModule,

    CategoriesModule,

    ProductsModule,

    AuthModule,

    SuppliersModule,

    PurchasesModule,

    PurchaseItemsModule,

    InventoryModule,

    CustomersModule,

    OrdersModule,

    OrderItemsModule,

    PaymentsModule,

    ExpensesModule,

    EmployeesModule,

    SupplierPaymentsModule,

    ReportsModule,

    WhatsAppModule,

    InvoicingModule,

    RealtimeModule,
  ],

  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: DatabaseExceptionFilter },
  ],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly usersSeeder: UsersSeeder) {}

  async onModuleInit() {
    await this.usersSeeder.seed();
  }
}
