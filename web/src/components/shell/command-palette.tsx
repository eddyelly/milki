'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, Map as MapIcon, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { ParcelSummary, TransferSummary } from '@/lib/types';
import { NAV } from './nav';

const PARCEL_RE = /^[A-Za-z]{2,4}-[A-Za-z]{2,4}-[0-9A-Za-z]{1,8}-[0-9A-Za-z]{1,8}$/;
const TRANSFER_RE = /^TRF-[A-Fa-f0-9]{16}$/;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** ⌘K / Ctrl+K: jump to any parcel, transfer or page (CLAUDE.md §9.3). */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 200);
  const router = useRouter();
  const { user } = useAuth();
  const canSeeTransfers = user?.role !== 'BANK_OFFICER';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useQuery({
    queryKey: ['palette', q],
    enabled: open && q.length >= 2,
    queryFn: async () => {
      const [p, t] = await Promise.all([
        get<ParcelSummary[]>('/parcels', { q, limit: 5 }),
        canSeeTransfers ? get<TransferSummary[]>('/transfers', { q, limit: 5 }) : Promise.resolve({ data: [] as TransferSummary[] }),
      ]);
      return { parcels: p.data, transfers: t.data };
    },
  });

  const go = (href: string) => {
    setOpen(false);
    setQuery('');
    router.push(href);
  };

  const pages = NAV.flatMap((s) => s.items).filter((i) => user && i.roles.includes(user.role));

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-9 w-full max-w-sm justify-start gap-2 bg-card text-muted-foreground sm:w-72"
        aria-label="Search parcels, transfers and pages"
      >
        <Search />
        <span className="truncate">Search parcel or transfer ID…</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-mono text-[11px] sm:inline">⌘K</kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search Milki" description="Find a parcel, transfer or page" shouldFilter={false}>
        <CommandInput placeholder="DSM-KIN-12-45, TRF-…, region, title number…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>{q.length < 2 ? 'Type at least 2 characters.' : results.isFetching ? 'Searching…' : 'No matches.'}</CommandEmpty>
          {PARCEL_RE.test(q) && (
            <CommandGroup heading="Open directly">
              <CommandItem value={`open-${q}`} onSelect={() => go(`/parcels/${q.toUpperCase()}`)}>
                <MapIcon /> Open parcel <span className="font-mono">{q.toUpperCase()}</span>
              </CommandItem>
            </CommandGroup>
          )}
          {TRANSFER_RE.test(q) && canSeeTransfers && (
            <CommandGroup heading="Open directly">
              <CommandItem value={`open-${q}`} onSelect={() => go(`/transfers/${q.toUpperCase()}`)}>
                <ArrowLeftRight /> Open transfer <span className="font-mono">{q.toUpperCase()}</span>
              </CommandItem>
            </CommandGroup>
          )}
          {(results.data?.parcels.length ?? 0) > 0 && (
            <CommandGroup heading="Parcels">
              {results.data?.parcels.map((p) => (
                <CommandItem key={p.parcelId} value={p.parcelId} onSelect={() => go(`/parcels/${p.parcelId}`)}>
                  <MapIcon />
                  <span className="font-mono">{p.parcelId}</span>
                  <span className="truncate text-muted-foreground">
                    {p.ward}, {p.district}
                  </span>
                  <StatusBadge kind="parcel" status={p.status} size="sm" className="ml-auto" />
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {(results.data?.transfers.length ?? 0) > 0 && (
            <CommandGroup heading="Transfers">
              {results.data?.transfers.map((t) => (
                <CommandItem key={t.transferId} value={t.transferId} onSelect={() => go(`/transfers/${t.transferId}`)}>
                  <ArrowLeftRight />
                  <span className="font-mono">{t.transferId}</span>
                  <span className="font-mono text-muted-foreground">{t.parcelId}</span>
                  <StatusBadge kind="transfer" status={t.status} size="sm" className="ml-auto" />
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandGroup heading="Pages">
            {pages
              .filter((p) => !q || p.title.toLowerCase().includes(q.toLowerCase()))
              .map((p) => (
                <CommandItem key={p.href} value={p.href} onSelect={() => go(p.href)}>
                  <p.icon /> {p.title}
                  <CommandShortcut>{p.href}</CommandShortcut>
                </CommandItem>
              ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
