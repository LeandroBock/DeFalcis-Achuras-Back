import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('CUSTOMERS')
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 30, nullable: true })
  phone?: string;

  @Column({ length: 150, nullable: true })
  email?: string;

  @Column({ type: 'text', nullable: true })
  address?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  // CUIT (11 dígitos) o DNI, sin guiones ni puntos
  @Column({ type: 'varchar', length: 20, nullable: true })
  taxId?: string;

  // Condición frente al IVA: 1 = Resp. Inscripto, 4 = Exento,
  // 5 = Consumidor Final, 6 = Monotributo
  @Column({ type: 'int', default: 5 })
  taxCondition: number;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}