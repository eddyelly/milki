'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Building2, MapPin, Pencil, Phone, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmAction } from '@/components/confirm-action';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { send } from '@/lib/api';
import { type LandOffice, useOffices } from '@/lib/admin';

type Draft = Omit<LandOffice, '_id'>;
const empty: Draft = { code: '', name: '', region: '', district: '', address: '', phone: '', email: '' };
const valid = (d: Draft, withCode: boolean) => (!withCode || /^[A-Z0-9-]{2,20}$/.test(d.code)) && d.name.trim().length >= 3 && d.region.trim().length >= 2 && d.district.trim().length >= 2;

function OfficeForm({ d, set, withCode }: { d: Draft; set: (d: Draft) => void; withCode: boolean }) {
  const field = (key: keyof Draft, label: string, placeholder?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`o-${key}`}>{label}</Label>
      <Input id={`o-${key}`} value={d[key]} placeholder={placeholder} onChange={(e) => set({ ...d, [key]: key === 'code' ? e.target.value.toUpperCase() : e.target.value })} className={key === 'code' ? 'font-mono' : undefined} />
    </div>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {withCode && field('code', 'Code', 'DSM-KIN')}
      <div className={withCode ? '' : 'sm:col-span-2'}>{field('name', 'Name', 'Kinondoni District Land Office')}</div>
      {field('region', 'Region', 'Dar es Salaam')}
      {field('district', 'District', 'Kinondoni')}
      <div className="sm:col-span-2">{field('address', 'Address')}</div>
      {field('phone', 'Phone')}
      {field('email', 'Email')}
    </div>
  );
}

export function OfficesView() {
  const qc = useQueryClient();
  const offices = useOffices();
  const [draft, setDraft] = useState<Draft>(empty);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['offices'] });
  return (
    <>
      <PageHeader
        title="Land offices"
        description="Regions and district offices staff belong to."
        actions={
          <ConfirmAction
            tier="T1"
            title="New land office"
            trigger={
              <Button>
                <Plus /> New office
              </Button>
            }
            canConfirm={valid(draft, true)}
            confirmLabel="Create"
            successMessage="Office created"
            onConfirm={(ctx) => send('post', '/admin/offices', draft, { idempotencyKey: ctx.idempotencyKey })}
            onSuccess={() => {
              setDraft(empty);
              refresh();
            }}
          >
            <OfficeForm d={draft} set={setDraft} withCode />
          </ConfirmAction>
        }
      />
      {offices.isError ? (
        <ErrorState error={offices.error} onRetry={() => void offices.refetch()} />
      ) : offices.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>
      ) : (offices.data ?? []).length === 0 ? (
        <EmptyState icon={<Building2 className="size-6" />} title="No land offices yet" description="Create the regional and district offices staff work from." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {offices.data!.map((o) => (
            <OfficeCard key={o._id} o={o} onChanged={refresh} />
          ))}
        </div>
      )}
    </>
  );
}

function OfficeCard({ o, onChanged }: { o: LandOffice; onChanged: () => void }) {
  const [d, setD] = useState<Draft>(() => ({ code: o.code, name: o.name, region: o.region, district: o.district, address: o.address, phone: o.phone, email: o.email }));
  const patch = { name: d.name, region: d.region, district: d.district, address: d.address, phone: d.phone, email: d.email };
  return (
    <Card>
      <CardContent className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-xs font-semibold text-muted-foreground">{o.code}</p>
            <h3 className="font-semibold">{o.name}</h3>
          </div>
          <div className="flex gap-1">
            <ConfirmAction
              tier="T1"
              title={`Edit ${o.name}`}
              trigger={
                <Button size="icon-sm" variant="ghost" aria-label={`Edit ${o.name}`}>
                  <Pencil />
                </Button>
              }
              canConfirm={valid(d, false)}
              confirmLabel="Save"
              successMessage="Office updated"
              onConfirm={(ctx) => send('patch', `/admin/offices/${o._id}`, patch, { idempotencyKey: ctx.idempotencyKey })}
              onSuccess={onChanged}
            >
              <OfficeForm d={d} set={setD} withCode={false} />
            </ConfirmAction>
            <ConfirmAction
              tier="T2"
              title={`Delete ${o.name}?`}
              consequences={['It disappears from office lists (soft delete).', 'Offices with active staff cannot be deleted. Move them first.']}
              typeToConfirm={o.code}
              trigger={
                <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label={`Delete ${o.name}`}>
                  <Trash2 />
                </Button>
              }
              confirmLabel="Delete"
              successMessage="Office deleted"
              onConfirm={(ctx) => send('delete', `/admin/offices/${o._id}`, undefined, { idempotencyKey: ctx.idempotencyKey })}
              onSuccess={onChanged}
            />
          </div>
        </div>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="size-3.5" aria-hidden /> {o.district}, {o.region}
        </p>
        {o.phone && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Phone className="size-3.5" aria-hidden /> {o.phone}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
