# WhatsApp en la app

La app se vincula al WhatsApp del negocio escaneando un QR, igual que WhatsApp Web. Desde ese momento los mensajes de los clientes llegan solos a la app, se responden desde ahí y se pueden convertir en pedidos. El celular sigue funcionando normalmente: lo que se escribe desde el celular también aparece en la app.

La app **nunca responde sola**: todas las respuestas las escribe una persona.

Todas las rutas requieren `Authorization: Bearer <token>`, salvo `/whatsapp/events` (ver abajo).

## 1. Vincular el celular (solo `super_admin` y `admin`)

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/whatsapp/connection` | Estado actual |
| `POST` | `/whatsapp/connection/connect` | Genera el QR para vincular |
| `POST` | `/whatsapp/connection/logout` | Desvincula el celular |

Las tres devuelven:

```json
{ "status": "waiting_qr", "phone": null, "qr": "data:image/png;base64,..." }
```

| `status` | Significado | Qué mostrar |
|---|---|---|
| `disabled` | La conexión está apagada en este servidor (`WHATSAPP_ENABLED`) | Un aviso |
| `disconnected` | No hay celular vinculado | Botón "Conectar WhatsApp" |
| `connecting` | Conectando o reconectando | Un indicador de carga |
| `waiting_qr` | Esperando que se escanee el QR | `<img src={qr}>` + instrucciones |
| `connected` | Vinculado; `phone` es el número | El número y un botón "Desvincular" |

Flujo: botón "Conectar" → `POST /connect` → mostrar el QR → en el celular, *WhatsApp → Dispositivos vinculados → Vincular un dispositivo* → escanear. El QR se renueva cada ~20 segundos: mientras `status` sea `waiting_qr`, volver a pedir `GET /connection` (o escuchar los eventos `connection`) y actualizar la imagen. Si nadie lo escanea, después de unos minutos pasa a `disconnected`.

Una vez vinculado no hace falta volver a escanear, aunque el servidor se reinicie.

## 2. Bandeja de conversaciones (`super_admin`, `admin`, `ventas`)

`GET /whatsapp/conversations` (acepta `?page=&limit=`) devuelve una fila por número, la más reciente primero:

```json
{
  "phone": "5493415556789",
  "customerId": "…",              // null si el número no es cliente
  "customerName": "Carnicería El Toro", // "Cliente desconocido" si no es cliente
  "contactName": "Toro",          // nombre que figura en WhatsApp (puede ser null)
  "lastMessage": "Hola, quiero 3 kg de chinchulín",
  "lastMessageDirection": "incoming",
  "lastMessageDate": "2026-10-13T15:04:29.096Z"
}
```

Sugerencia para el nombre: `customerName` si hay `customerId`, si no `contactName`, si no el número. Un número que no es cliente se puede dar de alta con `POST /customers` usando ese `phone`; el cliente se asocia aunque su teléfono se cargue en otro formato (`3415556789`, `0341 15 5556789`, etc.).

`GET /whatsapp/conversations/:phone` devuelve los mensajes de esa conversación (`messages`, del más viejo al más nuevo) y sus pedidos de WhatsApp (`orders`).

## 3. Responder (`super_admin`, `admin`, `ventas`)

```http
POST /whatsapp/conversations/5493415556789/messages
{ "message": "¿Cuántos kilos querés?" }
```

Envía el mensaje por WhatsApp y devuelve el mensaje guardado. Errores:

- `503`: WhatsApp no está conectado. Mostrar el mensaje de error y un enlace a la pantalla de conexión.
- `400`: el número no tiene WhatsApp, o el mensaje está vacío.

## 4. Tiempo real

Para que los mensajes aparezcan sin recargar, abrir un stream de eventos. Como `EventSource` no puede mandar el header `Authorization`, el token va en la URL (solo esta ruta lo acepta):

```js
const events = new EventSource(`${API_URL}/whatsapp/events?access_token=${token}`);

events.addEventListener('message', (e) => {
  const message = JSON.parse(e.data);
  // message.phone, message.direction ('incoming' | 'outgoing'), message.message,
  // message.createdAt, message.customerId, message.contactName
  // → agregarlo a la conversación abierta y subir esa conversación al tope.
});

events.addEventListener('connection', (e) => {
  const { status, phone } = JSON.parse(e.data);
  // → actualizar el indicador de conexión (el QR no viaja por acá: pedirlo a
  //   GET /whatsapp/connection).
});

// Cada 25 s llega un evento 'ping' para mantener viva la conexión; se ignora.
```

`EventSource` se reconecta solo si se corta. Al cerrar sesión, llamar a `events.close()`.

## 5. Tomar un pedido desde el chat (`super_admin`, `admin`, `ventas`)

1. `POST /whatsapp/orders/prepare` con `{ "phone": "5493415556789", "message": "quiero 3 kg de chinchulín" }`: interpreta el texto y devuelve el pedido armado (`order`) y un mensaje de confirmación sugerido (`confirmationMessage`). Si no entiende el producto o la cantidad, devuelve `found: false` o no trae `quantity`.
2. Opcional: enviarle al cliente `confirmationMessage` con el endpoint del punto 3.
3. `POST /whatsapp/orders/:id/confirm`: crea la **nota de pedido** (pendiente de entrega). El stock se descuenta y la venta se registra recién cuando el repartidor carga la entrega con los kilos reales. El número tiene que ser de un cliente cargado.

Para pedidos con varios productos, usar el alta normal de pedidos (`POST /orders`) con el `customerId` de la conversación.

## Puesta en marcha (Render)

- `WHATSAPP_ENABLED=true` **solo** en el servidor de producción. En local dejarla vacía: dos servidores con la misma sesión se desconectan entre sí.
- Plan **Starter** o superior (siempre encendido): en el plan gratuito el servidor se duerme y no recibe mensajes.
- **Una sola instancia** del servicio.
- Es una conexión no oficial: para reducir el riesgo de bloqueo del número, usarla para responder conversaciones, nunca para envíos masivos.
