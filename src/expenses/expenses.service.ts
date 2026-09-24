import { Injectable, NotFoundException } from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { Expense, ExpenseCategory } from './entities/expense.entity.js';

import { CreateExpenseDto } from './dto/create-expense.dto.js';

@Injectable()
export class ExpensesService {
  constructor(
    @InjectRepository(Expense)
    private readonly expensesRepository: Repository<Expense>,
  ) {}

  async create(createExpenseDto: CreateExpenseDto) {
    const expense = this.expensesRepository.create(createExpenseDto);

    return this.expensesRepository.save(expense);
  }

  async findAll() {
    return this.expensesRepository.find({
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async findOne(id: string) {
    const expense = await this.expensesRepository.findOne({
      where: {
        id,
      },
    });

    if (!expense) {
      throw new NotFoundException('Gasto no encontrado');
    }

    return expense;
  }

  async findByCategory(category: ExpenseCategory) {
    return this.expensesRepository.find({
      where: {
        category,
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }
}
