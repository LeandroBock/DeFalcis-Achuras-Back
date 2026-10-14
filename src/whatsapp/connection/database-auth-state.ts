import {
  AuthenticationCreds,
  AuthenticationState,
  BufferJSON,
  SignalDataTypeMap,
  initAuthCreds,
  proto,
} from '@whiskeysockets/baileys';
import { In, Repository } from 'typeorm';

import { WhatsAppAuth } from '../entities/whatsapp-auth.entity.js';

const CREDS_ID = 'creds';

const serialize = (value: unknown) =>
  JSON.stringify(value, BufferJSON.replacer);
const deserialize = <T>(data: string) =>
  JSON.parse(data, BufferJSON.reviver) as T;

// Igual que useMultiFileAuthState de Baileys, pero guardando en la tabla
// WHATSAPP_AUTH: una fila para las credenciales y una por cada clave.
export async function useDatabaseAuthState(
  repository: Repository<WhatsAppAuth>,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const stored = await repository.findOneBy({ id: CREDS_ID });
  const creds: AuthenticationCreds = stored
    ? deserialize(stored.data)
    : initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const rows = await repository.findBy({
            id: In(ids.map((id) => `${type}:${id}`)),
          });
          const byId = new Map(rows.map((row) => [row.id, row.data]));

          const result: { [id: string]: SignalDataTypeMap[typeof type] } = {};

          for (const id of ids) {
            const data = byId.get(`${type}:${id}`);
            if (!data) continue;

            let value = deserialize<SignalDataTypeMap[typeof type]>(data);
            if (type === 'app-state-sync-key') {
              value = proto.Message.AppStateSyncKeyData.fromObject(
                value as object,
              ) as unknown as SignalDataTypeMap[typeof type];
            }
            result[id] = value;
          }

          return result;
        },

        set: async (data) => {
          const upserts: { id: string; data: string }[] = [];
          const deletes: string[] = [];

          for (const type of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
            for (const [id, value] of Object.entries(data[type] ?? {})) {
              if (value) {
                upserts.push({ id: `${type}:${id}`, data: serialize(value) });
              } else {
                deletes.push(`${type}:${id}`);
              }
            }
          }

          await repository.manager.transaction(async (manager) => {
            const tx = manager.getRepository(WhatsAppAuth);
            if (upserts.length) await tx.upsert(upserts, ['id']);
            if (deletes.length) await tx.delete({ id: In(deletes) });
          });
        },
      },
    },

    saveCreds: async () => {
      await repository.upsert({ id: CREDS_ID, data: serialize(creds) }, ['id']);
    },
  };
}

// ¿Hay una sesión guardada de un dispositivo ya vinculado?
export async function hasStoredSession(repository: Repository<WhatsAppAuth>) {
  const stored = await repository.findOneBy({ id: CREDS_ID });
  return !!stored && !!deserialize<AuthenticationCreds>(stored.data).me;
}

export async function clearStoredSession(repository: Repository<WhatsAppAuth>) {
  await repository.clear();
}
