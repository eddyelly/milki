'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { get } from './api';
import type {
  Dispute,
  DocumentRef,
  Encumbrance,
  HistoryEntry,
  NotificationItem,
  Overview,
  PageMeta,
  Parcel,
  ParcelSummary,
  Transfer,
  TransferSummary,
} from './types';

const clean = (params: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null));

export interface ListParams {
  page?: number;
  limit?: number;
  q?: string;
  status?: string;
  sort?: string;
  [k: string]: unknown;
}

export const useOverview = (enabled = true) =>
  useQuery({ queryKey: ['stats', 'overview'], queryFn: async () => (await get<Overview>('/stats/overview')).data, enabled, refetchInterval: 60_000 });

export const useParcels = (params: ListParams) =>
  useQuery({
    queryKey: ['parcels', clean(params)],
    queryFn: async () => {
      const r = await get<ParcelSummary[]>('/parcels', clean(params));
      return { items: r.data, meta: r.meta as unknown as PageMeta };
    },
    placeholderData: keepPreviousData,
  });

export const useParcel = (parcelId: string) =>
  useQuery({ queryKey: ['parcel', parcelId], queryFn: async () => (await get<Parcel>(`/parcels/${parcelId}`)).data });

export const useParcelHistory = (parcelId: string) =>
  useQuery({ queryKey: ['parcel', parcelId, 'history'], queryFn: async () => (await get<HistoryEntry[]>(`/parcels/${parcelId}/history`)).data });

export const useParcelEncumbrances = (parcelId: string) =>
  useQuery({ queryKey: ['parcel', parcelId, 'encumbrances'], queryFn: async () => (await get<Encumbrance[]>(`/parcels/${parcelId}/encumbrances`)).data });

export const useParcelDisputes = (parcelId: string) =>
  useQuery({ queryKey: ['parcel', parcelId, 'disputes'], queryFn: async () => (await get<Dispute[]>(`/parcels/${parcelId}/disputes`)).data });

export const useParcelDocuments = (parcelId: string) =>
  useQuery({ queryKey: ['parcel', parcelId, 'documents'], queryFn: async () => (await get<DocumentRef[]>(`/parcels/${parcelId}/documents`)).data });

export const useParcelTransfers = (parcelId: string) =>
  useQuery({ queryKey: ['parcel', parcelId, 'transfers'], queryFn: async () => (await get<Transfer[]>(`/parcels/${parcelId}/transfers`)).data });

export const useTransfers = (params: ListParams, enabled = true) =>
  useQuery({
    queryKey: ['transfers', clean(params)],
    queryFn: async () => {
      const r = await get<TransferSummary[]>('/transfers', clean(params));
      return { items: r.data, meta: r.meta as unknown as PageMeta };
    },
    placeholderData: keepPreviousData,
    enabled,
  });

export const useTransfer = (transferId: string) =>
  useQuery({ queryKey: ['transfer', transferId], queryFn: async () => (await get<Transfer>(`/transfers/${transferId}`)).data });

export const useTransferDocuments = (transferId: string) =>
  useQuery({ queryKey: ['transfer', transferId, 'documents'], queryFn: async () => (await get<DocumentRef[]>(`/transfers/${transferId}/documents`)).data });

export const useNotifications = (params: { page?: number; limit?: number; unread?: 'true' } = {}) =>
  useQuery({
    queryKey: ['notifications', params],
    queryFn: async () => {
      const r = await get<NotificationItem[]>('/notifications', params);
      return { items: r.data, meta: r.meta as unknown as PageMeta & { unread: number } };
    },
    refetchInterval: 120_000,
  });
