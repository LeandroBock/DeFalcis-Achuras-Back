import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Precio especial de un producto para un cliente. Es un monto fijo: si el
// producto aumenta, el precio especial queda igual hasta que se edite.
@Index('UQ_CUSTOMER_PRICES_customer_product', ['customerId', 'productId'], {
  unique: true,
})
@Entity('CUSTOMER_PRICES')
export class CustomerPrice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  customerId: string;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  price: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
