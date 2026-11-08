import type { Namespace, Server, Socket } from 'socket.io';
import { isValidObjectId } from 'mongoose';
import type { AuthUser } from '../../core/auth';
import { logger } from '../../core/logger';
import { socketAuth } from '../../core/socket';
import { Ticket } from './support.models';

/**
 * Live chat (CLAUDE.md §11): namespace `/support`, one room per ticket (`ticket:<id>`), plus `ticket:<id>:staff`
 * for internal notes. Messages are written over REST (idempotent, audited) and fanned out here; the socket carries
 * typing indicators, read receipts and agent presence. Works across API instances through the Redis adapter.
 */
let nsp: Namespace | null = null;

export const STAFF = ['SUPPORT_AGENT', 'SYSTEM_ADMIN'] as const;
export const isStaff = (u: Pick<AuthUser, 'role'>) => (STAFF as readonly string[]).includes(u.role);

const room = (ticketId: string) => `ticket:${ticketId}`;
const staffRoom = (ticketId: string) => `ticket:${ticketId}:staff`;

type Ack = (r: { ok: boolean; error?: string }) => void;

export async function canAccessTicket(user: AuthUser, ticketId: string): Promise<boolean> {
  if (!isValidObjectId(ticketId)) return false;
  if (isStaff(user)) return !!(await Ticket.exists({ _id: ticketId, deletedAt: null }));
  return !!(await Ticket.exists({ _id: ticketId, userId: user.userId, deletedAt: null }));
}

async function onlineAgents(): Promise<string[]> {
  if (!nsp) return [];
  const sockets = await nsp.in('role:staff').fetchSockets().catch(() => []);
  return [...new Set(sockets.map((s) => (s.data.user as AuthUser).userId))];
}

async function broadcastPresence(): Promise<void> {
  if (!nsp) return;
  const agents = await onlineAgents();
  nsp.emit('presence', { agentsOnline: agents.length, agents });
}

export function attachSupportNamespace(io: Server): void {
  nsp = io.of('/support');
  nsp.use(socketAuth);
  nsp.on('connection', (socket: Socket) => {
    const user = socket.data.user as AuthUser;
    void socket.join(`user:${user.userId}`);
    if (isStaff(user)) {
      // Broadcast only once the join has landed (the Redis adapter joins asynchronously).
      void Promise.resolve(socket.join('role:staff')).then(() => broadcastPresence());
    } else {
      void onlineAgents().then((agents) => socket.emit('presence', { agentsOnline: agents.length, agents }));
    }

    socket.on('ticket:join', async (p: { ticketId?: string }, ack?: Ack) => {
      const id = String(p?.ticketId ?? '');
      if (!(await canAccessTicket(user, id))) return ack?.({ ok: false, error: 'FORBIDDEN' });
      await socket.join(isStaff(user) ? [room(id), staffRoom(id)] : [room(id)]);
      ack?.({ ok: true });
    });

    socket.on('ticket:leave', (p: { ticketId?: string }) => {
      const id = String(p?.ticketId ?? '');
      void socket.leave(room(id));
      void socket.leave(staffRoom(id));
    });

    /** `{ ticketId, typing, internal? }` — internal-note typing is shown to staff only. */
    socket.on('typing', (p: { ticketId?: string; typing?: boolean; internal?: boolean }) => {
      const id = String(p?.ticketId ?? '');
      if (!socket.rooms.has(room(id))) return;
      const target = p.internal && isStaff(user) ? staffRoom(id) : room(id);
      socket.to(target).emit('typing', { ticketId: id, userId: user.userId, role: user.role, typing: !!p.typing });
    });

    socket.on('disconnect', () => {
      if (isStaff(user)) void broadcastPresence();
    });
  });
  logger.info('socket.io /support namespace attached');
}

/** Message/ticket fan-out. Internal notes and staff-only events go to the staff room. */
export function emitTicket(ticketId: string, event: string, payload: unknown, staffOnly = false): void {
  nsp?.to(staffOnly ? staffRoom(ticketId) : room(ticketId)).emit(event, payload);
}

export function emitToSupportUser(userId: string, event: string, payload: unknown): void {
  nsp?.to(`user:${userId}`).emit(event, payload);
}

export function emitToStaff(event: string, payload: unknown): void {
  nsp?.to('role:staff').emit(event, payload);
}

/** Is this user watching the ticket chat right now? (Otherwise replies go out as push + email.) */
export async function isWatching(userId: string, ticketId: string): Promise<boolean> {
  if (!nsp) return false;
  const sockets = await nsp.in(room(ticketId)).fetchSockets().catch(() => []);
  return sockets.some((s) => (s.data.user as AuthUser).userId === userId);
}

export async function agentsOnline(): Promise<number> {
  return (await onlineAgents()).length;
}
