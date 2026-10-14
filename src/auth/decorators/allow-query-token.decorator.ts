import { SetMetadata } from '@nestjs/common';

export const ALLOW_QUERY_TOKEN_KEY = 'allowQueryToken';

// Permite enviar el token como ?access_token= en esta ruta. Solo para
// conexiones del navegador que no pueden mandar el header Authorization
// (EventSource / Server-Sent Events).
export const AllowQueryToken = () => SetMetadata(ALLOW_QUERY_TOKEN_KEY, true);
