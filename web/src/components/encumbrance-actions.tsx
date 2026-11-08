'use client';

import { Landmark, Pencil, Unlock } from 'lucide-react';
import { useState } from 'react';
import { ConfirmAction } from '@/components/confirm-action';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ledgerWrite } from '@/lib/actions';
import { useAuth } from '@/lib/auth';
import { fmtMoney, titleCase } from '@/lib/format';
import type { Encumbrance, Parcel } from '@/lib/types';

const TYPES = ['MORTGAGE', 'CHARGE', 'CAVEAT', 'LIEN'] as const;
const toAmount = (s: string) => Number(s.replace(/[,\s]/g, ''));

/** BANK_OFFICER: register a mortgage/charge for their bank (T3). The chaincode blocks it during transfers, disputes, freezes. */
export function AddEncumbrance({ p, lock }: { p: Parcel; lock: (open: boolean) => void }) {
  const { user } = useAuth();
  const [type, setType] = useState<(typeof TYPES)[number]>('MORTGAGE');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const blocked = Boolean(p.frozen || p.retired || p.activeTransferId || p.openDisputeIds.length);
  const valid = toAmount(amount) > 0 && reference.trim().length >= 2;
  return (
    <ConfirmAction
      tier="T3"
      title="Register an encumbrance"
      trigger={
        <Button disabled={blocked} title={blocked ? 'The parcel is frozen, disputed or in a transfer.' : undefined}>
          <Landmark /> Add mortgage / charge
        </Button>
      }
      impactSentence={
        <>
          {user?.bankName ?? 'Your bank'} will hold a {titleCase(type).toLowerCase()} on <span className="font-mono">{p.parcelId}</span>. The parcel cannot be transferred until it is released.
        </>
      }
      impact={[
        { label: 'Lender', value: user?.bankName ?? '—' },
        { label: 'Amount', value: valid ? fmtMoney(toAmount(amount)) : '—' },
        { label: 'Loan reference', value: reference || '—', mono: true },
      ]}
      canConfirm={valid}
      confirmLabel="Sign and register"
      successMessage="Encumbrance recorded on the ledger."
      onConfirm={(ctx) => ledgerWrite('post', `/parcels/${p.parcelId}/encumbrances`, { type, amount: toAmount(amount), currency: 'TZS', reference: reference.trim() }, ctx)}
      onOpenChange={(o) => {
        lock(o);
        if (o) {
          setAmount('');
          setReference('');
          setType('MORTGAGE');
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="enc-type">Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as (typeof TYPES)[number])}>
            <SelectTrigger id="enc-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {titleCase(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="enc-amount">Amount (TZS)</Label>
          <Input id="enc-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d,]/g, ''))} placeholder="120,000,000" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="enc-ref">Loan reference</Label>
        <Input id="enc-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="CRDB/HL/2026/001" className="font-mono" />
        <p className="text-xs text-muted-foreground">Your bank&apos;s reference only — never the borrower&apos;s personal details (they would be public on the ledger).</p>
      </div>
    </ConfirmAction>
  );
}

export function UpdateEncumbrance({ e, lock }: { e: Encumbrance; lock?: (open: boolean) => void }) {
  const [amount, setAmount] = useState(String(e.amount));
  const [reference, setReference] = useState(e.reference);
  const body: Record<string, unknown> = {};
  if (toAmount(amount) !== e.amount) body.amount = toAmount(amount);
  if (reference.trim() !== e.reference) body.reference = reference.trim();
  return (
    <ConfirmAction
      tier="T3"
      title="Update encumbrance"
      trigger={
        <Button size="sm" variant="outline">
          <Pencil /> Update
        </Button>
      }
      impactSentence={
        <>
          The terms of <span className="font-mono">{e.encumbranceId}</span> will change on the ledger; the old values stay in its history.
        </>
      }
      impact={[
        ...(body.amount !== undefined ? [{ label: 'Amount', value: `${fmtMoney(e.amount, e.currency)} → ${fmtMoney(toAmount(amount), e.currency)}` }] : []),
        ...(body.reference !== undefined ? [{ label: 'Reference', value: `${e.reference} → ${reference.trim()}`, mono: true }] : []),
      ]}
      canConfirm={Object.keys(body).length > 0 && toAmount(amount) > 0 && reference.trim().length >= 2}
      successMessage="Encumbrance updated."
      onConfirm={(ctx) => ledgerWrite('patch', `/encumbrances/${e.encumbranceId}`, body, ctx)}
      onOpenChange={(o) => {
        lock?.(o);
        if (o) {
          setAmount(String(e.amount));
          setReference(e.reference);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`amt-${e.encumbranceId}`}>Amount ({e.currency})</Label>
          <Input id={`amt-${e.encumbranceId}`} inputMode="numeric" value={amount} onChange={(ev) => setAmount(ev.target.value.replace(/[^\d,]/g, ''))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`ref-${e.encumbranceId}`}>Loan reference</Label>
          <Input id={`ref-${e.encumbranceId}`} value={reference} onChange={(ev) => setReference(ev.target.value)} className="font-mono" />
        </div>
      </div>
    </ConfirmAction>
  );
}

/** Release is destructive for the bank's security: T3 plus the typed encumbrance ID. */
export function ReleaseEncumbrance({ e, parcelId, lock }: { e: Encumbrance; parcelId: string; lock?: (open: boolean) => void }) {
  const [reason, setReason] = useState('');
  return (
    <ConfirmAction
      tier="T3"
      title="Release encumbrance"
      trigger={
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive">
          <Unlock /> Release
        </Button>
      }
      impactSentence={
        <>
          {e.lenderName} will no longer hold a {titleCase(e.type).toLowerCase()} on <span className="font-mono">{parcelId}</span>. If nothing else blocks it, the owner can transfer the parcel.
        </>
      }
      consequences={['Releasing cannot be undone — a new encumbrance would have to be registered.']}
      typeToConfirm={e.encumbranceId}
      canConfirm={reason.trim().length >= 3}
      confirmLabel="Sign and release"
      successMessage="Encumbrance released."
      onConfirm={(ctx) => ledgerWrite('post', `/encumbrances/${e.encumbranceId}/release`, { reason: reason.trim() }, ctx)}
      onOpenChange={(o) => {
        lock?.(o);
        if (o) setReason('');
      }}
    >
      <Label htmlFor={`rel-${e.encumbranceId}`}>Reason</Label>
      <Textarea id={`rel-${e.encumbranceId}`} rows={2} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. Loan repaid in full" />
    </ConfirmAction>
  );
}
