import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ExpensesService } from './expenses.service.js';

import { CreateExpenseDto } from './dto/create-expense.dto.js';

import { ExpenseCategory } from './entities/expense.entity.js';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

import { RolesGuard } from '../auth/guards/roles.guard.js';

import { Roles } from '../auth/decorators/roles.decorator.js';

import { UserRole } from '../users/entities/user.entity.js';

@ApiBearerAuth()
@Controller('expenses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.FINANZAS)
  findAll() {
    return this.expensesService.findAll();
  }

  @Get('category/:category')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.FINANZAS)
  findByCategory(
    @Param('category', new ParseEnumPipe(ExpenseCategory))
    category: ExpenseCategory,
  ) {
    return this.expensesService.findByCategory(category);
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.FINANZAS)
  findOne(
    @Param('id', ParseUUIDPipe)
    id: string,
  ) {
    return this.expensesService.findOne(id);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.FINANZAS)
  create(@Body() createExpenseDto: CreateExpenseDto) {
    return this.expensesService.create(createExpenseDto);
  }
}
