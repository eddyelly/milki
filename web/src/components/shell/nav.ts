import { ArrowLeftRight, Bell, BookOpen, FilePlus2, Headset, LayoutDashboard, type LucideIcon, Map, ScanSearch, ShieldAlert } from 'lucide-react';
import type { Overview, Role } from '@/lib/types';

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  roles: Role[];
  /** Live count shown as a badge (the caller's work queue). */
  badge?: (o: Overview, role: Role) => number;
}

const STAFF: Role[] = ['LAND_OFFICER', 'REGISTRAR', 'BANK_OFFICER', 'SUPPORT_AGENT', 'SYSTEM_ADMIN'];

export const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Overview', items: [{ title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: STAFF }] },
  {
    group: 'Registry',
    items: [
      { title: 'Parcels', href: '/parcels', icon: Map, roles: STAFF },
      { title: 'Register parcel', href: '/parcels/new', icon: FilePlus2, roles: ['REGISTRAR'] },
      {
        title: 'Transfers',
        href: '/transfers',
        icon: ArrowLeftRight,
        roles: ['LAND_OFFICER', 'REGISTRAR', 'SUPPORT_AGENT', 'SYSTEM_ADMIN'],
        badge: (o, role) =>
          role === 'LAND_OFFICER' ? o.queues.awaitingPayments + o.queues.awaitingVerification : role === 'REGISTRAR' ? o.queues.awaitingApproval : 0,
      },
    ],
  },
  {
    group: 'Support',
    items: [
      { title: 'Support queue', href: '/support', icon: Headset, roles: ['SUPPORT_AGENT', 'SYSTEM_ADMIN'], badge: (o) => o.support?.unassigned ?? 0 },
      { title: 'Escalations', href: '/escalations', icon: ShieldAlert, roles: ['LAND_OFFICER', 'REGISTRAR', 'SUPPORT_AGENT', 'SYSTEM_ADMIN'], badge: (o, role) => (role === 'LAND_OFFICER' || role === 'REGISTRAR' ? (o.support?.openEscalations ?? 0) : 0) },
      { title: 'Help centre', href: '/help', icon: BookOpen, roles: STAFF },
    ],
  },
  {
    group: 'Tools',
    items: [
      { title: 'Verify document', href: '/verify', icon: ScanSearch, roles: STAFF },
      { title: 'Notifications', href: '/notifications', icon: Bell, roles: STAFF },
    ],
  },
];
