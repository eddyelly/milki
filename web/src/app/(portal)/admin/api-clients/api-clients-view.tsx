'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Ban, Pencil, Plug, Plus, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { ConfirmAction } from '@/components/confirm-action';
import { type coreFeatures, DataTable } from '@/components/data-table';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { SecretReveal } from '@/components/secret-reveal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { API_URL, send } from '@/lib/api';
import { type ApiClientRow, PARTNER_SCOPES, type PartnerScope, useApiClients } from '@/lib/admin';
import { fmtAgo, fmtDate } from '@/lib/format';

const SCOPE_HELP: Record<PartnerScope, string> = {
  'parcels:verify': 'Read parcel status and check that a borrower owns a parcel',
  'encumbrances:write': 'Register, update and release this bank’s mortgages and charges',
};

function Scopes({ value, onChange }: { value: PartnerScope[]; onChange: (v: PartnerScope[]) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium">Scopes</legend>
      {PARTNER_SCOPES.map((s) => (
        <label key={s} className="flex items-start gap-2 rounded-lg border p-2.5 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={value.includes(s)} onChange={(e) => onChange(e.target.checked ? [...value, s] : value.filter((x) => x !== s))} />
          <span>
            <span className="font-mono font-semibold">{s}</span>
            <span className="block text-muted-foreground">{SCOPE_HELP[s]}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function ApiClientsView() {
  const qc = useQueryClient();
  const clients = useApiClients();
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [d, setD] = useState({ name: '', bankCode: '', bankName: '', scopes: ['parcels:verify'] as PartnerScope[], rateLimitPerMin: '60' });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['api-clients'] });
  const valid = d.name.trim().length >= 3 && /^[A-Z0-9]{2,10}$/.test(d.bankCode) && d.bankName.trim().length >= 2 && d.scopes.length > 0 && Number(d.rateLimitPerMin) >= 1;

  const columns: ColumnDef<typeof coreFeatures, ApiClientRow>[] = [
    {
      id: 'client',
      header: 'Client',
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.name}</p>
          <p className="font-mono text-xs text-muted-foreground">{row.original.keyHint}</p>
        </div>
      ),
    },
    { id: 'bank', header: 'Bank', cell: ({ row }) => <span className="text-sm">{row.original.bankName} <span className="font-mono text-xs text-muted-foreground">{row.original.bankCode}</span></span> },
    {
      id: 'scopes',
      header: 'Scopes',
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.scopes.map((s) => (
            <Badge key={s} variant="secondary" className="font-mono">
              {s}
            </Badge>
          ))}
        </div>
      ),
    },
    { id: 'rate', header: 'Rate limit', cell: ({ row }) => <span className="text-sm">{row.original.rateLimitPerMin}/min</span> },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) =>
        row.original.status === 'ACTIVE' ? <Badge className="bg-success/15 text-success">Active</Badge> : <Badge className="bg-destructive/12 text-destructive">Revoked {fmtDate(row.original.revokedAt)}</Badge>,
    },
    { id: 'used', header: 'Last used', cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.lastUsedAt ? fmtAgo(row.original.lastUsedAt) : 'Never'}</span> },
    { id: 'actions', header: '', cell: ({ row }) => (row.original.status === 'ACTIVE' ? <ClientActions c={row.original} onChanged={refresh} onSecret={setSecret} /> : null) },
  ];

  return (
    <>
      <PageHeader
        title="API clients"
        description={
          <>
            Bank systems calling the partner API at <span className="font-mono text-sm">{API_URL}/partner</span> with an <span className="font-mono text-sm">x-api-key</span> header. Every call is audited.
          </>
        }
        actions={
          <ConfirmAction
            tier="T1"
            title="New API client"
            description="The key is shown once after creation. Milki keeps only its hash."
            trigger={
              <Button>
                <Plus /> New client
              </Button>
            }
            canConfirm={valid}
            confirmLabel="Create and show key"
            onConfirm={(ctx) =>
              send<{ client: ApiClientRow; apiKey: string }>('post', '/admin/api-clients', { name: d.name.trim(), bankCode: d.bankCode, bankName: d.bankName.trim(), scopes: d.scopes, rateLimitPerMin: Number(d.rateLimitPerMin) }, { idempotencyKey: ctx.idempotencyKey })
            }
            onSuccess={(r) => {
              refresh();
              setD({ name: '', bankCode: '', bankName: '', scopes: ['parcels:verify'], rateLimitPerMin: '60' });
              setSecret({ title: `API key for ${r.client.name}`, value: r.apiKey });
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="c-name">Name</Label>
                <Input id="c-name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="CRDB core banking" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-code">Bank code</Label>
                <Input id="c-code" value={d.bankCode} onChange={(e) => setD({ ...d, bankCode: e.target.value.toUpperCase() })} placeholder="CRDB" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-bank">Bank name</Label>
                <Input id="c-bank" value={d.bankName} onChange={(e) => setD({ ...d, bankName: e.target.value })} placeholder="CRDB Bank" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-rate">Requests per minute</Label>
                <Input id="c-rate" inputMode="numeric" value={d.rateLimitPerMin} onChange={(e) => setD({ ...d, rateLimitPerMin: e.target.value.replace(/\D/g, '') })} />
              </div>
            </div>
            <Scopes value={d.scopes} onChange={(s) => setD({ ...d, scopes: s })} />
          </ConfirmAction>
        }
      />
      {clients.isError ? (
        <ErrorState error={clients.error} onRetry={() => void clients.refetch()} />
      ) : (
        <DataTable columns={columns} data={clients.data} loading={clients.isLoading} rowLabel={(c) => c.name} empty={<EmptyState icon={<Plug className="size-6" />} title="No API clients" description="Create one for each bank system that needs to verify ownership or register mortgages." />} />
      )}
      <SecretReveal open={!!secret} title={secret?.title ?? ''} label="API key" secret={secret?.value ?? null} note="Send it to the bank over a secure channel. It will not be shown again." onClose={() => setSecret(null)} />
    </>
  );
}

function ClientActions({ c, onChanged, onSecret }: { c: ApiClientRow; onChanged: () => void; onSecret: (s: { title: string; value: string }) => void }) {
  const [scopes, setScopes] = useState<PartnerScope[]>(c.scopes);
  const [rate, setRate] = useState(String(c.rateLimitPerMin));
  const [reason, setReason] = useState('');
  const changed = scopes.slice().sort().join() !== c.scopes.slice().sort().join() || Number(rate) !== c.rateLimitPerMin;
  return (
    <div className="flex justify-end gap-1">
      <ConfirmAction
        tier="T1"
        title={`Edit ${c.name}`}
        impact={[
          { label: 'Scopes', value: scopes.join(', ') || '—', mono: true },
          { label: 'Rate limit', value: `${rate}/min` },
        ]}
        trigger={
          <Button size="icon-sm" variant="ghost" aria-label={`Edit ${c.name}`}>
            <Pencil />
          </Button>
        }
        canConfirm={changed && scopes.length > 0 && Number(rate) >= 1}
        confirmLabel="Save"
        successMessage="API client updated"
        onConfirm={(ctx) => send('patch', `/admin/api-clients/${c.clientId}`, { scopes, rateLimitPerMin: Number(rate) }, { idempotencyKey: ctx.idempotencyKey })}
        onSuccess={onChanged}
      >
        <Scopes value={scopes} onChange={setScopes} />
        <div className="space-y-1.5">
          <Label htmlFor={`rate-${c.clientId}`}>Requests per minute</Label>
          <Input id={`rate-${c.clientId}`} inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value.replace(/\D/g, ''))} />
        </div>
      </ConfirmAction>
      <ConfirmAction
        tier="T2"
        title={`Rotate the key for ${c.name}?`}
        consequences={['The current key stops working immediately.', 'The bank must switch to the new key, shown once.']}
        typeToConfirm={c.bankCode}
        trigger={
          <Button size="icon-sm" variant="ghost" aria-label={`Rotate key for ${c.name}`}>
            <RotateCw />
          </Button>
        }
        confirmLabel="Rotate key"
        onConfirm={(ctx) => send<{ apiKey: string }>('post', `/admin/api-clients/${c.clientId}/rotate`, {}, { idempotencyKey: ctx.idempotencyKey })}
        onSuccess={(r) => {
          onChanged();
          onSecret({ title: `New API key for ${c.name}`, value: r.apiKey });
        }}
      />
      <ConfirmAction
        tier="T2"
        title={`Revoke ${c.name}?`}
        consequences={['All calls with this key are refused from now on.', 'Revocation is permanent — create a new client to restore access.']}
        typeToConfirm="REVOKE"
        canConfirm={reason.trim().length >= 3}
        trigger={
          <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label={`Revoke ${c.name}`}>
            <Ban />
          </Button>
        }
        confirmLabel="Revoke"
        successMessage="API client revoked"
        onConfirm={(ctx) => send('post', `/admin/api-clients/${c.clientId}/revoke`, { reason: reason.trim() }, { idempotencyKey: ctx.idempotencyKey })}
        onSuccess={onChanged}
      >
        <Label htmlFor={`rev-${c.clientId}`}>Reason</Label>
        <Textarea id={`rev-${c.clientId}`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmAction>
    </div>
  );
}

