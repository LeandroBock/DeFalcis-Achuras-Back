import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

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
        synchronize: true, // 💡 Nota: se recomienda 'false' en producción para evitar pérdida de datos
        dropSchema: false,
        logging: true,
        // ⚠️ ADVERTENCIA: Supabase exige SSL activo en servidores en la nube como Render
        ssl: {
          rejectUnauthorized: false, 
        },
      }),
    }),


    UsersModule,

    CategoriesModule,

    ProductsModule,

    AuthModule,

    ProductsModule,

    CategoriesModule,

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
  ],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly usersSeeder: UsersSeeder) {}

  async onModuleInit() {
    await this.usersSeeder.seed();
  }
}
