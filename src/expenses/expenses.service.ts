import { Injectable, NotFoundException } from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { Expense, ExpenseCategory } from './entities/expense.entity.js';

import { CreateExpenseDto } from './dto/create-expense.dto.js';
import { UpdateExpenseDto } from './dto/update-expense.dto.js';
import {
  PaginationQueryDto,
  findMaybePaginated,
} from '../common/pagination.js';

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

  async findAll(query: PaginationQueryDto) {
    return findMaybePaginated(
      this.expensesRepository,
      { order: { createdAt: 'DESC', id: 'DESC' } },
      query,
    );
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

  async update(id: string, updateExpenseDto: UpdateExpenseDto) {
    const expense = await this.findOne(id);

    Object.assign(expense, updateExpenseDto);

    return this.expensesRepository.save(expense);
  }

  async remove(id: string) {
    const expense = await this.findOne(id);

    await this.expensesRepository.remove(expense);

    return {
      message: 'Gasto eliminado correctamente',
    };
  }
}
