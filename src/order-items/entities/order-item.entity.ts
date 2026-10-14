import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Index('IDX_ORDER_ITEMS_orderId', ['orderId'])
@Entity('ORDER_ITEMS')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  orderId: string;

  @Column({ type: 'uuid' })
  productId: string;

  // Kilos/unidades entregados (mientras la nota está pendiente, los pedidos).
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 3,
  })
  quantity: number;

  // Lo que se pidió en la nota (0 si se agregó en el momento de la entrega).
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 3,
    default: 0,
  })
  requestedQuantity: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
  })
  unitPrice: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
  })
  subtotal: number;

  @CreateDateColumn()
  createdAt: Date;
}
