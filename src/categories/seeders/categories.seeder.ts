import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Category } from '../entities/category.entity.js';

@Injectable()
export class CategoriesSeeder implements OnModuleInit {
  constructor(
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
  ) {}

  async onModuleInit() {
    await this.seed();
  }

  async seed() {
    const categories = [
      {
        name: 'Achuras',
        description: 'Achuras frescas para parrilla',
      },
      {
        name: 'Carnes',
        description: 'Cortes de carne vacuna',
      },
      {
        name: 'Embutidos',
        description: 'Chorizos, morcillas y otros embutidos',
      },
      {
        name: 'Pollos',
        description: 'Productos y cortes de pollo',
      },
      {
        name: 'Promociones',
        description: 'Combos y promociones especiales',
      },
    ];

    for (const categoryData of categories) {
      const existing = await this.categoriesRepository.findOne({
        where: {
          name: categoryData.name,
        },
      });

      if (!existing) {
        const category = this.categoriesRepository.create(categoryData);

        await this.categoriesRepository.save(category);
      }
    }

    console.log('Categorías verificadas correctamente');
  }
}
