import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from './entities/user.entity.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import * as bcrypt from 'bcrypt';
import { CreateAdminUserDto } from './dto/create-admin-user.dto.js';

export const BCRYPT_ROUNDS = 12;

export type PublicUser = Omit<User, 'password'>;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<PublicUser> {
    return this.createWithHashedPassword(createUserDto);
  }

  async findAll(): Promise<User[]> {
    return this.usersRepository.find();
  }

  // Incluye el hash de la contraseña: usar solo para autenticación.
  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();
  }

  async createAdminUser(
    createUserDto: CreateAdminUserDto,
  ): Promise<PublicUser> {
    return this.createWithHashedPassword(createUserDto);
  }

  private async createWithHashedPassword(
    dto: CreateUserDto | CreateAdminUserDto,
  ): Promise<PublicUser> {
    const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = this.usersRepository.create({
      name: dto.name,
      email: dto.email,
      role: dto.role,
      password: hashedPassword,
    });

    const { password: _password, ...savedUser } =
      await this.usersRepository.save(user);

    return savedUser;
  }
}
