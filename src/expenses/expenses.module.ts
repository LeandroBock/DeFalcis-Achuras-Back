import { Module } from '@nestjs/common';

import { TypeOrmModule } from '@nestjs/typeorm';

import { ExpensesController } from './expenses.controller.js';

import { ExpensesService } from './expenses.service.js';

import { Expense } from './entities/expense.entity.js';

import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([Expense]), AuthModule],

  controllers: [ExpensesController],

  providers: [ExpensesService],

  exports: [ExpensesService],
})
export class ExpensesModule {}
