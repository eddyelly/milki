import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server, type Socket } from 'socket.io';
import { env } from '../config/env';
import { verifyAccessToken } from './auth';
import { newBullConnection } from './datastores';
import { logger } from './logger';

let io: Server | null = null;

/** Access-token handshake shared by every namespace. */
export function socketAuth(socket: Socket, next: (err?: Error) => void): void {
  const token = (socket.handshake.auth as { token?: unknown }).token;
  const user = typeof token === 'string' ? verifyAccessToken(token) : null;
  if (!user) return next(new Error('UNAUTHORIZED'));
  socket.data.user = user;
  next();
}

const attachHooks: ((io: Server) => void)[] = [];

/** Lets feature modules add namespaces (e.g. `/support`) without core depending on them. */
export function onSocketAttached(hook: (io: Server) => void): void {
  attachHooks.push(hook);
}

/** Socket.IO with the Redis adapter. Clients authenticate with `auth: { token: <accessToken> }`. */
export function attachSocket(server: HttpServer): Server {
  io = new Server(server, { cors: { origin: env.CORS_ORIGINS, credentials: true } });
  io.adapter(createAdapter(newBullConnection(), newBullConnection()));
  io.use(socketAuth);
  io.on('connection', (socket) => {
    const user = socket.data.user as { userId: string; role: string };
    void socket.join([`user:${user.userId}`, `role:${user.role}`]);
  });
  for (const hook of attachHooks) hook(io);
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
