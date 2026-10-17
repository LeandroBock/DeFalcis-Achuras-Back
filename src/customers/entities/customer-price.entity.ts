import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Precio especial de un producto para un cliente: un monto fijo (si el
// producto aumenta queda igual hasta que se edite) o un porcentaje de
// descuento que se aplica sobre el precio de su lista. Uno de los dos.
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

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  price: number | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  discountPercent: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
