import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ProductUnit {
  KG = 'kg',
  UNIT = 'unit',
}

@Entity('PRODUCTS')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: ProductUnit,
  })
  unit: ProductUnit;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
  })
  salePrice: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
  })
  costPrice: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 3,
    default: 0,
  })
  stock: number;

  @Column({ default: true })
  isActive: boolean;

  @Column({ length: 50 })
  category: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
