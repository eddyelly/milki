'use client';

import { LogOut, ShieldCheck, ShieldQuestion } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/brand';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { useAuth } from '@/lib/auth';
import { MSP_LABEL, ROLE_LABEL } from '@/lib/format';
import { useOverview } from '@/lib/queries';
import { NAV } from './nav';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

export function AppSidebar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const { data: overview } = useOverview(Boolean(user));
  if (!user) return null;

  const isActive = (href: string) => (href === '/parcels' ? pathname === '/parcels' || /^\/parcels\/(?!new)/.test(pathname) : pathname.startsWith(href));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        <Link href="/dashboard" className="rounded-md text-sidebar-foreground outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
          <Logo inverted className="group-data-[collapsible=icon]:[&>span:last-child]:hidden" />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {NAV.map((section) => {
          const items = section.items.filter((i) => i.roles.includes(user.role));
          if (items.length === 0) return null;
          return (
            <SidebarGroup key={section.group}>
              <SidebarGroupLabel className="text-sidebar-foreground/60">{section.group}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
                    const count = overview && item.badge ? item.badge(overview, user.role) : 0;
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive(item.href)}
                          tooltip={item.title}
                          className="data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground"
                        >
                          <Link href={item.href}>
                            <item.icon />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                        {count > 0 && (
                          <SidebarMenuBadge className="rounded-full bg-gold font-mono text-[11px] text-ink" aria-label={`${count} waiting`}>
                            {count}
                          </SidebarMenuBadge>
                        )}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter className="gap-3 p-3">
        <div className="flex items-center gap-2.5 rounded-lg bg-sidebar-accent/60 p-2 group-data-[collapsible=icon]:hidden">
          <Avatar className="size-9">
            <AvatarFallback className="bg-gold font-semibold text-ink">{initials(user.fullName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 text-sm">
            <p className="truncate font-semibold text-sidebar-accent-foreground">{user.fullName}</p>
            <p className="truncate text-xs text-sidebar-foreground/70">
              {ROLE_LABEL[user.role]}
              {user.bankName ? ` · ${user.bankName}` : ''}
            </p>
            <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-sidebar-foreground/70" title="Your Fabric identity">
              {user.ledgerIdentity.enrolled ? <ShieldCheck className="size-3 text-gold" aria-hidden /> : <ShieldQuestion className="size-3" aria-hidden />}
              {user.ledgerIdentity.enrolled ? `Signs as ${MSP_LABEL[user.ledgerIdentity.mspId ?? ''] ?? user.ledgerIdentity.mspId}` : 'Ledger identity pending'}
            </p>
          </div>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Sign out" onClick={() => void logout()}>
              <LogOut />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
