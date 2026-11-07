'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { get, getAccessToken, onAccessToken, SOCKET_URL } from './api';
import type { LedgerTxStatus } from './types';

interface SocketContextValue {
  connected: boolean;
  /** Resolves when the ledger commits (socket `ledger:tx`, with polling as a fallback). */
  waitForCommit(txId: string, timeoutMs?: number): Promise<LedgerTxStatus>;
  subscribe(event: string, handler: (payload: unknown) => void): () => void;
}

const SocketContext = createContext<SocketContextValue | null>(null);

/** Query keys refreshed whenever the ledger reports a change involving this user or their queues. */
const LIVE_KEYS = [['parcels'], ['parcel'], ['transfers'], ['transfer'], ['stats'], ['notifications']];

export function SocketProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const handlers = useRef(new Map<string, Set<(p: unknown) => void>>());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const connect = (token: string | null) => {
      socketRef.current?.close();
      socketRef.current = null;
      setConnected(false);
      if (!token) return;
      const s = io(SOCKET_URL, { auth: { token }, transports: ['websocket'] });
      s.on('connect', () => setConnected(true));
      s.on('disconnect', () => setConnected(false));
      s.onAny((event: string, payload: unknown) => {
        for (const h of handlers.current.get(event) ?? []) h(payload);
        if (event === 'ledger:event' || event === 'queue:updated' || event === 'notification') {
          for (const key of LIVE_KEYS) void qc.invalidateQueries({ queryKey: key });
        }
      });
      socketRef.current = s;
    };
    connect(getAccessToken());
    const off = onAccessToken(connect);
    return () => {
      off();
      socketRef.current?.close();
    };
  }, [qc]);

  const subscribe = useCallback((event: string, handler: (payload: unknown) => void) => {
    const set = handlers.current.get(event) ?? new Set();
    set.add(handler);
    handlers.current.set(event, set);
    return () => {
      set.delete(handler);
    };
  }, []);

  const waitForCommit = useCallback(
    (txId: string, timeoutMs = 90_000) =>
      new Promise<LedgerTxStatus>((resolve, reject) => {
        let done = false;
        const finish = (s: LedgerTxStatus) => {
          if (done) return;
          done = true;
          clearInterval(poll);
          clearTimeout(timer);
          off();
          if (s.status === 'COMMITTED') resolve(s);
          else reject(new Error('The ledger rejected this transaction. Nothing was changed.'));
        };
        const off = subscribe('ledger:tx', (p) => {
          const s = p as LedgerTxStatus;
          if (s.txId === txId && s.status !== 'SUBMITTED') finish(s);
        });
        const poll = setInterval(() => {
          void get<LedgerTxStatus>(`/ledger/tx/${txId}`)
            .then((r) => r.data.status !== 'SUBMITTED' && finish(r.data))
            .catch(() => undefined);
        }, 2000);
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          clearInterval(poll);
          off();
          reject(new Error('Still waiting for the ledger. Your request was submitted — check back shortly.'));
        }, timeoutMs);
      }),
    [subscribe],
  );

  return <SocketContext.Provider value={{ connected, waitForCommit, subscribe }}>{children}</SocketContext.Provider>;
}

export function useLedgerSocket(): SocketContextValue {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useLedgerSocket must be used inside <SocketProvider>');
  return ctx;
}
