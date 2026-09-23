import type { IncomingMessage, ServerResponse } from 'node:http';
export function createProxy(options?: { townOrigin?: string; loomEndpoint?: string; allowedOrigins?: string[] }): (req: IncomingMessage, res: ServerResponse, next?: () => void) => Promise<void>;
