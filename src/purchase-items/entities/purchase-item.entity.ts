import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Index('IDX_PURCHASE_ITEMS_purchaseId', ['purchaseId'])
@Entity('PURCHASE_ITEMS')
export class PurchaseItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  purchaseId: string;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 3,
  })
  quantity: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
  })
  unitCost: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
  })
  subtotal: number;

  @CreateDateColumn()
  createdAt: Date;
}
