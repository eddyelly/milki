'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { get } from './api';
import type { PageMeta, Role } from './types';

export interface AdminUser {
  userId: string;
  role: Role;
  fullName: string;
  email: string | null;
  phone: string;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'DEACTIVATED';
  bankCode: string | null;
  bankName: string | null;
  officeId: string | null;
  ledgerIdentity: { enrolled: boolean; mspId: string | null };
  lastLoginAt: string | null;
  createdAt: string;
}

export interface LandOffice {
  _id: string;
  code: string;
  name: string;
  region: string;
  district: string;
  address: string;
  phone: string;
  email: string;
}

export const PARTNER_SCOPES = ['parcels:verify', 'encumbrances:write'] as const;
export type PartnerScope = (typeof PARTNER_SCOPES)[number];

export interface ApiClientRow {
  clientId: string;
  name: string;
  bankCode: string;
  bankName: string;
  scopes: PartnerScope[];
  keyHint: string;
  rateLimitPerMin: number;
  status: 'ACTIVE' | 'REVOKED';
  lastUsedAt: string | null;
  rotatedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface AuditRow {
  _id: string;
  at: string;
  action: string;
  actor: { userId: string; role: string } | null;
  actorName: string | null;
  entityType?: string;
  entityId?: string;
  txId?: string;
  outcome: 'SUCCESS' | 'FAILURE';
  ip?: string;
  meta?: Record<string, unknown>;
}

export interface EncumbranceRow {
  encumbranceId: string;
  parcelId: string;
  type: string;
  lenderCode: string;
  lenderName: string;
  amount: number;
  currency: string;
  reference: string;
  status: 'ACTIVE' | 'RELEASED';
  releasedAt: string | null;
  ledgerCreatedAt: string;
  ledgerUpdatedAt: string;
}

const clean = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== '' && v !== null && v !== 'ALL'));
async function page<T>(url: string, params: Record<string, unknown>) {
  const r = await get<T[]>(url, clean(params));
  return { items: r.data, meta: r.meta as unknown as PageMeta };
}

export const useAdminUsers = (params: Record<string, unknown>) =>
  useQuery({ queryKey: ['admin-users', clean(params)], queryFn: () => page<AdminUser>('/admin/users', params), placeholderData: keepPreviousData });
export const useAuditLog = (params: Record<string, unknown>) =>
  useQuery({ queryKey: ['admin-audit', clean(params)], queryFn: () => page<AuditRow>('/admin/audit', params), placeholderData: keepPreviousData });
export const useEncumbranceBook = (params: Record<string, unknown>) =>
  useQuery({ queryKey: ['encumbrances', clean(params)], queryFn: () => page<EncumbranceRow>('/encumbrances', params), placeholderData: keepPreviousData });
export const useOffices = () => useQuery({ queryKey: ['offices'], queryFn: async () => (await get<LandOffice[]>('/offices')).data, staleTime: 60_000 });
export const useApiClients = () => useQuery({ queryKey: ['api-clients'], queryFn: async () => (await get<ApiClientRow[]>('/admin/api-clients')).data });

export const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'LAND_OFFICER', label: 'Land officer' },
  { value: 'REGISTRAR', label: 'Registrar' },
  { value: 'BANK_OFFICER', label: 'Bank officer' },
  { value: 'SUPPORT_AGENT', label: 'Support agent' },
  { value: 'SYSTEM_ADMIN', label: 'System admin' },
];
