import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum WhatsAppMessageDirection {
  INCOMING = 'incoming',
  OUTGOING = 'outgoing',
}

export enum WhatsAppMessageType {
  TEXT = 'text',
  IMAGE = 'image',
  AUDIO = 'audio',
  DOCUMENT = 'document',
  OTHER = 'other',
}

export enum WhatsAppMessageStatus {
  RECEIVED = 'received',
  SENT = 'sent',
  FAILED = 'failed',
}

@Index('IDX_WHATSAPP_MESSAGES_phone', ['phone'])
// Evita guardar dos veces el mismo mensaje (WhatsApp reenvía eventos y los
// mensajes enviados desde la app vuelven como eco).
@Index('UQ_WHATSAPP_MESSAGES_externalMessageId', ['externalMessageId'], {
  unique: true,
  where: '"externalMessageId" IS NOT NULL',
})
@Entity('WHATSAPP_MESSAGES')
export class WhatsAppMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 30 })
  phone: string;

  @Column({
    type: 'enum',
    enum: WhatsAppMessageDirection,
  })
  direction: WhatsAppMessageDirection;

  @Column({
    type: 'enum',
    enum: WhatsAppMessageType,
    default: WhatsAppMessageType.TEXT,
  })
  type: WhatsAppMessageType;

  @Column({ type: 'text', nullable: true })
  message?: string;

  @Column({ type: 'uuid', nullable: true })
  customerId?: string;

  // Nombre con el que el contacto figura en WhatsApp (sirve para identificar
  // números que todavía no están cargados como clientes).
  @Column({ length: 100, nullable: true })
  contactName?: string;

  @Column({ length: 150, nullable: true })
  externalMessageId?: string;

  @Column({
    type: 'enum',
    enum: WhatsAppMessageStatus,
    default: WhatsAppMessageStatus.RECEIVED,
  })
  status: WhatsAppMessageStatus;

  @CreateDateColumn()
  createdAt: Date;
}
