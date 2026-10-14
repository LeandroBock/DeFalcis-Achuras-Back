import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// Sesión de WhatsApp (credenciales y claves de cifrado de Baileys). Se guarda
// en la base porque el disco de Render se borra en cada deploy: así no hay
// que volver a escanear el QR después de un reinicio.
@Entity('WHATSAPP_AUTH')
export class WhatsAppAuth {
  @PrimaryColumn({ length: 255 })
  id: string;

  @Column({ type: 'text' })
  data: string;

  @UpdateDateColumn()
  updatedAt: Date;
}
