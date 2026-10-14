import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Una sesión por login. El token lleva su id (sid): cerrar sesión, resetear
// la contraseña o bloquear al usuario la revoca y el token deja de servir al
// instante, aunque no haya vencido.
@Index('IDX_USER_SESSIONS_userId', ['userId'])
@Entity('USER_SESSIONS')
export class UserSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  // Navegador o celular desde el que se ingresó (para identificarla).
  @Column({ type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
