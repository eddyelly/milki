import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { verifyAccessToken } from './auth';
import { newBullConnection } from './datastores';
import { logger } from './logger';

let io: Server | null = null;

/** Socket.IO with the Redis adapter. Clients authenticate with `auth: { token: <accessToken> }`. */
export function attachSocket(server: HttpServer): Server {
  io = new Server(server, { cors: { origin: env.CORS_ORIGINS, credentials: true } });
  io.adapter(createAdapter(newBullConnection(), newBullConnection()));
  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown }).token;
    const user = typeof token === 'string' ? verifyAccessToken(token) : null;
    if (!user) return next(new Error('UNAUTHORIZED'));
    socket.data.user = user;
    next();
  });
  io.on('connection', (socket) => {
    const user = socket.data.user as { userId: string; role: string };
    void socket.join([`user:${user.userId}`, `role:${user.role}`]);
  });
  logger.info('socket.io attached');
  return io;
}

/** Emits to every connection of one user. No-op when sockets are not attached (tests, scripts). */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function emitToRole(role: string, event: string, payload: unknown): void {
  io?.to(`role:${role}`).emit(event, payload);
}

export async function closeSocket(): Promise<void> {
  await io?.close();
  io = null;
}
