import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import { User, UserRole } from '../entities/user.entity.js';
import { BCRYPT_ROUNDS } from '../users.service.js';

@Injectable()
export class UsersSeeder {
  private readonly logger = new Logger(UsersSeeder.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly configService: ConfigService,
  ) {}

  // Crea el super admin inicial solo si SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD
  // están definidas y el usuario todavía no existe.
  async seed() {
    const email = this.configService.get<string>('SEED_ADMIN_EMAIL');
    const plainPassword = this.configService.get<string>('SEED_ADMIN_PASSWORD');

    if (!email || !plainPassword) {
      return;
    }

    const existingUser = await this.usersRepository.findOne({
      where: { email },
    });

    if (existingUser) {
      return;
    }

    const password = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);

    const user = this.usersRepository.create({
      name: 'Administrador DF Achuras',
      email,
      password,
      role: UserRole.SUPER_ADMIN,
      isActive: true,
    });

    await this.usersRepository.save(user);

    this.logger.log(`Super admin inicial creado: ${email}`);
  }
}
