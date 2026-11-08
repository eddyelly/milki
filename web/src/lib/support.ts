'use client';

import { keepPreviousData, type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleDot, Clock3, Hourglass, Lock } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { get, getAccessToken, http, onAccessToken, send, SOCKET_URL } from './api';
import type { StatusMeta } from './status';
import type { PageMeta, Role } from './types';

// ------------------------------------------------------------------------------------------ types
export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'AWAITING_USER', 'RESOLVED', 'CLOSED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export const TICKET_CATEGORIES = ['GETTING_STARTED', 'TRANSFERS', 'DOCUMENTS', 'MORTGAGES', 'ACCOUNT', 'OTHER'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export interface Attachment {
  key: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
}

export interface Sla {
  target: 'FIRST_RESPONSE' | 'RESOLUTION' | 'NONE';
  dueAt: string | null;
  state: 'OK' | 'WARNING' | 'BREACHED' | 'MET';
  elapsed: number;
}

export interface Ticket {
  id: string;
  number: string;
  userId: string;
  category: TicketCategory;
  priority: TicketPriority;
  subject: string;
  description: string;
  status: TicketStatus;
  assigneeId: string | null;
  tags: string[];
  parcelId: string | null;
  transferId: string | null;
  attachments: Attachment[];
  firstResponseDueAt: string;
  resolveDueAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  lastMessageAt: string;
  rating: { stars: number; comment: string; at: string } | null;
  createdAt: string;
  updatedAt: string;
  sla: Sla;
  canReopenUntil: string | null;
  requester: string | null;
  assignee: string | null;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  authorId: string;
  authorRole: Role;
  author: string | null;
  body: string;
  internal: boolean;
  attachments: Attachment[];
  readBy: { userId: string; at: string }[];
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface TicketContext {
  user: { userId: string; fullName: string; phone: string; email: string | null; role: Role; preferredLanguage: 'en' | 'sw'; memberSince: string } | null;
  linked: { parcelId: string | null; transferId: string | null };
  parcels: { parcelId: string; titleNumber: string; region: string; district: string; ward: string; area: number; landUse: string; status: string; activeTransferId: string | null; ledgerUpdatedAt: string }[];
  transfers: { transferId: string; parcelId: string; status: string; side: 'SELLER' | 'BUYER'; ledgerUpdatedAt: string }[];
  previousTickets: { _id: string; number: string; subject: string; status: TicketStatus; createdAt: string }[];
}

export interface CannedResponse {
  _id: string;
  title: string;
  body: string;
  tags: string[];
}

export interface Escalation {
  id: string;
  ticketId: string;
  ticketNumber: string;
  note: string;
  parcelId: string | null;
  transferId: string | null;
  status: 'OPEN' | 'DONE';
  createdByName: string | null;
  doneByName: string | null;
  doneAt: string | null;
  resolution: string | null;
  subject: string | null;
  priority: TicketPriority | null;
  createdAt: string;
}

export interface Localized {
  en: string;
  sw: string;
}

export interface KbCategory {
  _id: string;
  slug: string;
  name: Localized;
  icon: string;
  order: number;
  articleCount: number;
}

export interface KbArticle {
  _id: string;
  slug: string;
  categorySlug: string;
  title: Localized;
  body: Localized;
  tags: string[];
  status: 'DRAFT' | 'PUBLISHED';
  helpfulYes: number;
  helpfulNo: number;
  views: number;
  updatedAt: string;
  publishedAt: string | null;
}

export interface SupportMetrics {
  days: number;
  openTickets: number;
  slaBreached: number;
  byStatus: Partial<Record<TicketStatus, number>>;
  byCategory: { category: TicketCategory; count: number }[];
  avgFirstResponseMinutes: number | null;
  avgResolutionHours: number | null;
  csat: { average: number | null; ratings: number; trend: { week: string; average: number; ratings: number }[] };
  agentsOnline: number;
}

// ------------------------------------------------------------------------------------- labels/meta
export const TICKET_STATUS: Record<TicketStatus, StatusMeta> = {
  OPEN: { label: 'Open', labelSw: 'Wazi', icon: CircleDot, color: 'var(--status-pending)', ink: 'var(--status-pending-ink)', description: 'Waiting for an agent.' },
  IN_PROGRESS: { label: 'In progress', labelSw: 'Inashughulikiwa', icon: Clock3, color: 'var(--info)', description: 'An agent is working on it.' },
  AWAITING_USER: { label: 'Awaiting user', labelSw: 'Inasubiri mteja', icon: Hourglass, color: 'var(--earth)', description: 'Waiting for the requester to reply.' },
  RESOLVED: { label: 'Resolved', labelSw: 'Imetatuliwa', icon: CircleCheck, color: 'var(--status-completed)', description: 'Solved; the requester can reopen within 7 days.' },
  CLOSED: { label: 'Closed', labelSw: 'Imefungwa', icon: Lock, color: 'var(--status-frozen)', description: 'Closed for good.' },
};

export const PRIORITY: Record<TicketPriority, { label: string; color: string; rank: number }> = {
  URGENT: { label: 'Urgent', color: 'var(--danger)', rank: 0 },
  HIGH: { label: 'High', color: 'var(--earth)', rank: 1 },
  NORMAL: { label: 'Normal', color: 'var(--info)', rank: 2 },
  LOW: { label: 'Low', color: 'var(--status-frozen)', rank: 3 },
};

export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  GETTING_STARTED: 'Getting started',
  TRANSFERS: 'Transfers',
  DOCUMENTS: 'Documents',
  MORTGAGES: 'Mortgages',
  ACCOUNT: 'Account',
  OTHER: 'Other',
};

export const STAFF_SUPPORT: Role[] = ['SUPPORT_AGENT', 'SYSTEM_ADMIN'];
export const isSupportStaff = (role: Role | undefined) => !!role && STAFF_SUPPORT.includes(role);

// ----------------------------------------------------------------------------------------- queries
const clean = (params: Record<string, unknown>) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null));

export interface TicketListParams {
  page?: number;
  limit?: number;
  q?: string;
  status?: string;
  priority?: string;
  category?: string;
  assignee?: string;
  sort?: string;
}

export const useTickets = (params: TicketListParams) =>
  useQuery({
    queryKey: ['tickets', clean({ ...params })],
    queryFn: async () => {
      const r = await get<Ticket[]>('/tickets', clean({ ...params }));
      return { items: r.data, meta: r.meta as unknown as PageMeta };
    },
    placeholderData: keepPreviousData,
    refetchInterval: 60_000, // keeps the SLA timers honest even without socket events
  });

export const useTicket = (id: string) => useQuery({ queryKey: ['ticket', id], queryFn: async () => (await get<Ticket>(`/tickets/${id}`)).data });
export const useTicketMessages = (id: string) => useQuery({ queryKey: ['ticket', id, 'messages'], queryFn: async () => (await get<TicketMessage[]>(`/tickets/${id}/messages`)).data });
export const useTicketContext = (id: string) => useQuery({ queryKey: ['ticket', id, 'context'], queryFn: async () => (await get<TicketContext>(`/tickets/${id}/context`)).data });
export const useCanned = (q = '') => useQuery({ queryKey: ['canned', q], queryFn: async () => (await get<CannedResponse[]>('/support/canned', clean({ q }))).data });
export const useAgents = () =>
  useQuery({ queryKey: ['support', 'agents'], queryFn: async () => (await get<{ userId: string; fullName: string; role: Role }[]>('/support/agents')).data, staleTime: 300_000 });
export const useEscalations = (status: 'OPEN' | 'DONE' | 'ALL') =>
  useQuery({ queryKey: ['escalations', status], queryFn: async () => (await get<Escalation[]>('/support/escalations', { status })).data });
export const useSupportMetrics = (enabled: boolean, days = 30) =>
  useQuery({ queryKey: ['support', 'metrics', days], queryFn: async () => (await get<SupportMetrics>('/support/metrics', { days })).data, enabled, refetchInterval: 60_000 });

export const useKbCategories = () => useQuery({ queryKey: ['kb', 'categories'], queryFn: async () => (await get<KbCategory[]>('/kb/categories')).data });
export const useKbArticles = (params: { q?: string; category?: string; status?: 'PUBLISHED' | 'DRAFT' | 'ALL'; limit?: number }) =>
  useQuery({
    queryKey: ['kb', 'articles', clean({ ...params })],
    queryFn: async () => (await get<KbArticle[]>('/kb/articles', clean({ limit: 50, ...params }))).data,
    placeholderData: keepPreviousData,
  });
export const useKbArticle = (slug: string | null) =>
  useQuery({ queryKey: ['kb', 'article', slug], queryFn: async () => (await get<KbArticle>(`/kb/articles/${slug}`)).data, enabled: !!slug });

// ------------------------------------------------------------------------------------------- writes
export const ticketWrite = <T,>(method: 'post' | 'patch' | 'delete', url: string, body: unknown, idempotencyKey: string) => send<T>(method, url, body, { idempotencyKey });

export async function postMessage(ticketId: string, body: string, internal: boolean, file: File | null, idempotencyKey: string): Promise<TicketMessage> {
  if (!file) return send<TicketMessage>('post', `/tickets/${ticketId}/messages`, { body, internal }, { idempotencyKey });
  const form = new FormData();
  form.append('body', body);
  form.append('internal', String(internal));
  form.append('file', file);
  const r = await http.post<{ data: TicketMessage }>(`/tickets/${ticketId}/messages`, form, { headers: { 'Idempotency-Key': idempotencyKey } });
  return r.data.data;
}

export async function downloadAttachment(ticketId: string, a: Attachment): Promise<void> {
  const r = await http.get<Blob>(`/tickets/${ticketId}/attachments/${a.sha256}`, { responseType: 'blob' });
  const url = URL.createObjectURL(r.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = a.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ------------------------------------------------------------------------------ live chat (/support)
function upsertMessage(qc: QueryClient, ticketId: string, m: TicketMessage) {
  qc.setQueryData<TicketMessage[]>(['ticket', ticketId, 'messages'], (old) => {
    if (!old) return old;
    const i = old.findIndex((x) => x.id === m.id);
    if (i === -1) return [...old, m];
    const next = old.slice();
    next[i] = m;
    return next;
  });
}

let shared: Socket | null = null;
let sharedToken: string | null = null;
/** Last presence pushed by the server; pages mounted later start from it (the socket only sends changes). */
let lastPresence: number | null = null;
const presenceListeners = new Set<(n: number) => void>();

/** One `/support` connection per tab (CLAUDE.md §11), re-created when the access token rotates. */
function supportSocket(): Socket | null {
  const token = getAccessToken();
  if (!token) return null;
  if (shared && sharedToken === token) return shared;
  shared?.close();
  sharedToken = token;
  shared = io(`${SOCKET_URL}/support`, { auth: { token }, transports: ['websocket'] });
  shared.on('presence', (p: { agentsOnline: number }) => {
    lastPresence = p.agentsOnline;
    presenceListeners.forEach((l) => l(p.agentsOnline));
  });
  return shared;
}

export interface TypingUser {
  userId: string;
  role: Role;
}

/** Agents online: the last value pushed on `/support`, else a REST read, then live updates. */
export function useSupportPresence(): number | null {
  const [live, setLive] = useState<number | null>(() => lastPresence);
  const initial = useQuery({ queryKey: ['support', 'presence'], queryFn: async () => (await get<{ agentsOnline: number }>('/support/presence')).data.agentsOnline, enabled: live === null });
  useEffect(() => {
    supportSocket(); // make sure the connection (and its presence listener) exists
    presenceListeners.add(setLive);
    const off = onAccessToken(() => supportSocket());
    return () => {
      off();
      presenceListeners.delete(setLive);
    };
  }, []);
  return live ?? initial.data ?? null;
}

/** Refreshes queue lists when tickets change anywhere (staff room). */
export function useQueueLive(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const s = supportSocket();
    if (!s) return;
    const h = () => {
      void qc.invalidateQueries({ queryKey: ['tickets'] });
      void qc.invalidateQueries({ queryKey: ['support', 'metrics'] });
    };
    s.on('queue:updated', h);
    return () => {
      s.off('queue:updated', h);
    };
  }, [qc]);
}

/** Joins a ticket room: live messages, typing, read receipts and ticket updates. */
export function useTicketChat(ticketId: string, selfId: string | undefined) {
  const qc = useQueryClient();
  const [typing, setTyping] = useState<TypingUser[]>([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const s = supportSocket();
    socketRef.current = s;
    if (!s) return;
    const join = () => {
      setConnected(true);
      s.emit('ticket:join', { ticketId });
    };
    const onNew = (m: TicketMessage) => m.ticketId === ticketId && upsertMessage(qc, ticketId, m);
    const onDeleted = (p: { id: string; ticketId: string }) =>
      p.ticketId === ticketId && qc.setQueryData<TicketMessage[]>(['ticket', ticketId, 'messages'], (old) => old?.map((m) => (m.id === p.id ? { ...m, body: '', attachments: [], deletedAt: new Date().toISOString() } : m)));
    const onTicket = (t: Ticket) => {
      if (t.id !== ticketId) return;
      qc.setQueryData<Ticket>(['ticket', ticketId], (old) => (old ? { ...old, ...t } : t));
      // Socket payloads carry IDs, not display names: refetch so "assigned to …" stays right.
      void qc.invalidateQueries({ queryKey: ['ticket', ticketId], exact: true });
      void qc.invalidateQueries({ queryKey: ['tickets'] });
    };
    const onRead = (p: { ticketId: string; userId: string; at: string }) =>
      p.ticketId === ticketId &&
      qc.setQueryData<TicketMessage[]>(['ticket', ticketId, 'messages'], (old) =>
        old?.map((m) => (m.authorId !== p.userId && !m.readBy.some((r) => r.userId === p.userId) ? { ...m, readBy: [...m.readBy, { userId: p.userId, at: p.at }] } : m)),
      );
    const onTyping = (p: { ticketId: string; userId: string; role: Role; typing: boolean }) => {
      if (p.ticketId !== ticketId || p.userId === selfId) return;
      const timers = typingTimers.current;
      clearTimeout(timers.get(p.userId));
      setTyping((list) => [...list.filter((x) => x.userId !== p.userId), ...(p.typing ? [{ userId: p.userId, role: p.role }] : [])]);
      // A lost "stopped typing" must not leave the dots up forever.
      if (p.typing) timers.set(p.userId, setTimeout(() => setTyping((list) => list.filter((x) => x.userId !== p.userId)), 6000));
    };
    if (s.connected) join();
    s.on('connect', join);
    s.on('disconnect', () => setConnected(false));
    s.on('message:new', onNew);
    s.on('message:updated', onNew);
    s.on('message:deleted', onDeleted);
    s.on('ticket:updated', onTicket);
    s.on('read', onRead);
    s.on('typing', onTyping);
    const timers = typingTimers.current;
    return () => {
      s.emit('ticket:leave', { ticketId });
      s.off('connect', join);
      s.off('message:new', onNew);
      s.off('message:updated', onNew);
      s.off('message:deleted', onDeleted);
      s.off('ticket:updated', onTicket);
      s.off('read', onRead);
      s.off('typing', onTyping);
      timers.forEach((t) => clearTimeout(t));
    };
  }, [ticketId, selfId, qc]);

  const lastTyping = useRef(0);
  const sendTyping = useCallback(
    (isTyping: boolean, internal: boolean) => {
      const now = Date.now();
      if (isTyping && now - lastTyping.current < 2000) return; // throttle
      lastTyping.current = isTyping ? now : 0;
      socketRef.current?.emit('typing', { ticketId, typing: isTyping, internal });
    },
    [ticketId],
  );

  return { typing, connected, sendTyping, addLocal: (m: TicketMessage) => upsertMessage(qc, ticketId, m) };
}

// ------------------------------------------------------------------------------------------- SLA
export function slaText(sla: Sla, now = Date.now()): string {
  if (sla.state === 'MET') return 'SLA met';
  if (!sla.dueAt) return sla.state === 'BREACHED' ? 'SLA missed' : '—';
  const diff = new Date(sla.dueAt).getTime() - now;
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const span = h >= 48 ? `${Math.floor(h / 24)}d` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  const what = sla.target === 'FIRST_RESPONSE' ? 'first reply' : 'resolution';
  return diff >= 0 ? `${what} in ${span}` : `${what} overdue ${span}`;
}
