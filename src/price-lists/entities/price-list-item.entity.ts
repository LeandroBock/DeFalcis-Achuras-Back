import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Precio fijo de un producto dentro de una lista.
@Index('UQ_PRICE_LIST_ITEMS_list_product', ['priceListId', 'productId'], {
  unique: true,
})
@Entity('PRICE_LIST_ITEMS')
export class PriceListItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  priceListId: string;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  price: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
