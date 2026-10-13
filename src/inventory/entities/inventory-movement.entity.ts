import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum InventoryMovementType {
  ENTRY = 'entry',
  EXIT = 'exit',
  ADJUSTMENT = 'adjustment',
}

@Index('IDX_INVENTORY_MOVEMENTS_productId', ['productId'])
@Entity('INVENTORY_MOVEMENTS')
export class InventoryMovement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  productId: string;

  @Column({
    type: 'enum',
    enum: InventoryMovementType,
  })
  type: InventoryMovementType;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 3,
  })
  quantity: number;

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @Column({ type: 'uuid', nullable: true })
  referenceId?: string;

  @CreateDateColumn()
  createdAt: Date;
}
