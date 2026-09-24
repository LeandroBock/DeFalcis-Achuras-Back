import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CategoriesController } from './categories.controller.js';
import { CategoriesService } from './categories.service.js';
import { Category } from './entities/category.entity.js';
import { AuthModule } from '../auth/auth.module.js';
import { CategoriesSeeder } from './seeders/categories.seeder.js';

@Module({
  imports: [TypeOrmModule.forFeature([Category]), AuthModule],
  controllers: [CategoriesController],
  providers: [CategoriesService, CategoriesSeeder],
  exports: [CategoriesService],
})
export class CategoriesModule {}
