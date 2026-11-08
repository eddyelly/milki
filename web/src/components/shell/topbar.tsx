'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Monitor, Moon, Sun } from 'lucide-react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { http } from '@/lib/api';
import { fmtAgo } from '@/lib/format';
import { useNotifications } from '@/lib/queries';
import { useLedgerSocket } from '@/lib/socket';
import { cn } from '@/lib/utils';
import { CommandPalette } from './command-palette';

export function Topbar() {
  const { connected } = useLedgerSocket();
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-4">
      <SidebarTrigger aria-label="Toggle sidebar" />
      <div className="flex flex-1 justify-center sm:justify-start sm:pl-2">
        <CommandPalette />
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex" aria-live="polite">
            <span className={cn('size-2 rounded-full', connected ? 'bg-success' : 'bg-muted-foreground/50')} />
            {connected ? 'Live' : 'Offline'}
          </span>
        </TooltipTrigger>
        <TooltipContent>{connected ? 'Receiving ledger updates in real time' : 'Reconnecting to live updates…'}</TooltipContent>
      </Tooltip>
      <NotificationBell />
      <ThemeToggle />
    </header>
  );
}

function ThemeToggle() {
  const { setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change theme">
          <Sun className="dark:hidden" />
          <Moon className="hidden dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme('light')}>
          <Sun /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>
          <Moon /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>
          <Monitor /> System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationBell() {
  const { data } = useNotifications({ limit: 6 });
  const qc = useQueryClient();
  const unread = data?.meta.unread ?? 0;
  // Read receipts are UI state, not data the user creates, no confirmation dialog (see CLAUDE.md §8 note).
  const markAll = useMutation({
    mutationFn: () => http.post('/notifications/read-all', {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markOne = useMutation({
    mutationFn: (id: string) => http.post(`/notifications/${id}/read`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
          <Bell />
          {unread > 0 && (
            <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-earth px-1 font-mono text-[10px] font-bold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <DropdownMenuLabel className="p-0 text-sm font-semibold">Notifications</DropdownMenuLabel>
          <Button variant="ghost" size="sm" disabled={!unread || markAll.isPending} onClick={() => markAll.mutate()}>
            <CheckCheck /> Mark all read
          </Button>
        </div>
        <ul className="max-h-80 overflow-y-auto">
          {(data?.items ?? []).length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">You’re all caught up.</li>}
          {data?.items.map((n) => {
            const href = n.data.transferId ? `/transfers/${n.data.transferId}` : n.data.parcelId ? `/parcels/${n.data.parcelId}` : '/notifications';
            return (
              <li key={n._id}>
                <Link href={href} onClick={() => !n.readAt && markOne.mutate(n._id)} className="flex gap-2 px-3 py-2.5 hover:bg-accent">
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-primary')} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{n.title}</span>
                    <span className="line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>
                    <span className="block text-[11px] text-muted-foreground">{fmtAgo(n.createdAt)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <DropdownMenuSeparator className="m-0" />
        <Link href="/notifications" className="block px-3 py-2 text-center text-sm font-medium text-primary hover:bg-accent">
          View all
        </Link>
      </PopoverContent>
    </Popover>
  );
}
