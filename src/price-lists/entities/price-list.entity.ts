import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Lista de precios para un grupo de clientes (mayoristas, restaurantes...).
// Cada producto cuesta su precio fijo en la lista si tiene uno; si no, el
// precio normal ajustado por adjustmentPercent (-10 = 10% menos).
@Entity('PRICE_LISTS')
export class PriceList {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
  adjustmentPercent: number;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
