import {
  Column,
  CreateDateColumn,
  Entity,
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
