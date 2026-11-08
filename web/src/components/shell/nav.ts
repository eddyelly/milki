import { ArrowLeftRight, Bell, BookOpen, Building2, FilePlus2, Headset, Landmark, LayoutDashboard, type LucideIcon, Map, Plug, ScanSearch, ScrollText, ShieldAlert, Users } from 'lucide-react';
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
      { title: 'Encumbrances', href: '/encumbrances', icon: Landmark, roles: ['BANK_OFFICER', 'REGISTRAR', 'LAND_OFFICER', 'SYSTEM_ADMIN'] },
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
    group: 'Administration',
    items: [
      { title: 'Users', href: '/admin/users', icon: Users, roles: ['SYSTEM_ADMIN'] },
      { title: 'Land offices', href: '/admin/offices', icon: Building2, roles: ['SYSTEM_ADMIN'] },
      { title: 'API clients', href: '/admin/api-clients', icon: Plug, roles: ['SYSTEM_ADMIN'] },
      { title: 'Audit log', href: '/admin/audit', icon: ScrollText, roles: ['SYSTEM_ADMIN'] },
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
