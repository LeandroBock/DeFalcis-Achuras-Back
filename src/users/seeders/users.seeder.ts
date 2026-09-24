import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import { User, UserRole } from '../entities/user.entity.js';

@Injectable()
export class UsersSeeder {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async seed() {
    const email = 'admin@dfachuras.com';

    const existingUser = await this.usersRepository.findOne({
      where: { email },
    });

    if (existingUser) {
      return;
    }

    const password = await bcrypt.hash('Admin123456', 10);

    const user = this.usersRepository.create({
      name: 'Administrador DF Achuras',
      email,
      password,
      role: UserRole.SUPER_ADMIN,
      isActive: true,
    });

    await this.usersRepository.save(user);

    console.log('✅ Super Admin creado correctamente');
  }
}
