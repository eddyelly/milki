'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { KeyRound, Pencil, Search, ShieldCheck, ShieldOff, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConfirmAction } from '@/components/confirm-action';
import { type coreFeatures, DataTable, Pagination } from '@/components/data-table';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { SecretReveal } from '@/components/secret-reveal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { send } from '@/lib/api';
import { type AdminUser, type LandOffice, ROLE_OPTIONS, useAdminUsers, useOffices } from '@/lib/admin';
import { useAuth } from '@/lib/auth';
import { fmtAgo, ROLE_LABEL } from '@/lib/format';
import type { Role } from '@/lib/types';

interface Form {
  role: Role;
  fullName: string;
  phone: string;
  email: string;
  officeId: string;
  bankCode: string;
  bankName: string;
}
const emptyForm: Form = { role: 'LAND_OFFICER', fullName: '', phone: '', email: '', officeId: 'none', bankCode: '', bankName: '' };
const validForm = (f: Form, creating: boolean) =>
  f.fullName.trim().length >= 3 && /\S+@\S+\.\S+/.test(f.email) && (!creating || /^(\+?255|0)[67]\d{8}$/.test(f.phone.replace(/[\s()-]/g, ''))) && (f.role !== 'BANK_OFFICER' || (f.bankCode.trim().length >= 2 && f.bankName.trim().length >= 2));

function UserForm({ f, set, offices, creating, roleLocked }: { f: Form; set: (f: Form) => void; offices: LandOffice[]; creating: boolean; roleLocked?: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="u-name">Full name</Label>
        <Input id="u-name" value={f.fullName} onChange={(e) => set({ ...f, fullName: e.target.value })} />
      </div>
      {creating && (
        <div className="space-y-1.5">
          <Label htmlFor="u-phone">Phone (receives sign-in codes)</Label>
          <Input id="u-phone" value={f.phone} onChange={(e) => set({ ...f, phone: e.target.value })} placeholder="0713 000 000" />
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="u-email">Email</Label>
        <Input id="u-email" type="email" value={f.email} onChange={(e) => set({ ...f, email: e.target.value })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="u-role">Role</Label>
        <Select value={f.role} onValueChange={(v) => set({ ...f, role: v as Role })} disabled={roleLocked}>
          <SelectTrigger id="u-role" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLE_OPTIONS.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="u-office">Land office</Label>
        <Select value={f.officeId} onValueChange={(v) => set({ ...f, officeId: v })}>
          <SelectTrigger id="u-office" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {offices.map((o) => (
              <SelectItem key={o._id} value={o._id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {f.role === 'BANK_OFFICER' && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="u-bankcode">Bank code</Label>
            <Input id="u-bankcode" value={f.bankCode} onChange={(e) => set({ ...f, bankCode: e.target.value.toUpperCase() })} placeholder="CRDB" className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-bankname">Bank name</Label>
            <Input id="u-bankname" value={f.bankName} onChange={(e) => set({ ...f, bankName: e.target.value })} placeholder="CRDB Bank" />
          </div>
        </>
      )}
    </div>
  );
}

const STATUS_BADGE: Record<AdminUser['status'], { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'bg-success/15 text-success' },
  PENDING_VERIFICATION: { label: 'Pending', className: 'bg-gold/25 text-gold-ink' },
  DEACTIVATED: { label: 'Deactivated', className: 'bg-muted text-muted-foreground' },
};

export function UsersView() {
  const qc = useQueryClient();
  const offices = useOffices();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [role, setRole] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<Form>(emptyForm);
  const [secret, setSecret] = useState<{ title: string; value: string; note: string } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const users = useAdminUsers({ q: debounced, role, status, page, limit: 20 });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin-users'] });
  const officeName = (id: string | null) => offices.data?.find((o) => o._id === id)?.name ?? '—';

  const columns: ColumnDef<typeof coreFeatures, AdminUser>[] = [
    {
      id: 'user',
      header: 'User',
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="font-medium">{row.original.fullName}</p>
          <p className="truncate text-xs text-muted-foreground">{row.original.email ?? row.original.phone}</p>
        </div>
      ),
    },
    { id: 'role', header: 'Role', cell: ({ row }) => <span className="text-sm">{ROLE_LABEL[row.original.role]}{row.original.bankCode ? ` · ${row.original.bankCode}` : ''}</span> },
    { id: 'office', header: 'Office', cell: ({ row }) => <span className="text-sm text-muted-foreground">{officeName(row.original.officeId)}</span> },
    { id: 'status', header: 'Status', cell: ({ row }) => <Badge className={STATUS_BADGE[row.original.status].className}>{STATUS_BADGE[row.original.status].label}</Badge> },
    {
      id: 'ledger',
      header: 'Ledger identity',
      cell: ({ row }) =>
        row.original.ledgerIdentity.enrolled ? (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <ShieldCheck className="size-3.5" aria-hidden /> {row.original.ledgerIdentity.mspId}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">On first ledger action</span>
        ),
    },
    { id: 'seen', header: 'Last sign-in', cell: ({ row }) => <span className="text-sm text-muted-foreground">{fmtAgo(row.original.lastLoginAt)}</span> },
    { id: 'actions', header: '', cell: ({ row }) => <UserActions u={row.original} offices={offices.data ?? []} onChanged={refresh} onSecret={setSecret} /> },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        description="Staff accounts and roles. Landowners register themselves in the mobile app."
        actions={
          <ConfirmAction
            tier="T1"
            title="Create a staff account"
            description="A one-time password is shown once and emailed. Sign-in also needs an SMS code to the phone number."
            trigger={
              <Button>
                <UserPlus /> New staff account
              </Button>
            }
            canConfirm={validForm(form, true)}
            confirmLabel="Create account"
            onConfirm={(ctx) =>
              send<{ user: AdminUser; temporaryPassword: string }>(
                'post',
                '/admin/users',
                {
                  role: form.role,
                  fullName: form.fullName.trim(),
                  phone: form.phone,
                  email: form.email.trim(),
                  ...(form.officeId !== 'none' ? { officeId: form.officeId } : {}),
                  ...(form.role === 'BANK_OFFICER' ? { bankCode: form.bankCode.trim(), bankName: form.bankName.trim() } : {}),
                },
                { idempotencyKey: ctx.idempotencyKey },
              )
            }
            onSuccess={(r) => {
              setForm(emptyForm);
              refresh();
              setSecret({ title: `Account created for ${r.user.fullName}`, value: r.temporaryPassword, note: 'Give this one-time password to the user (it was also emailed). It will not be shown again.' });
            }}
          >
            <UserForm f={form} set={setForm} offices={offices.data ?? []} creating />
          </ConfirmAction>
        }
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email or phone" className="bg-card pl-9" aria-label="Search users" />
        </div>
        <Select value={role} onValueChange={(v) => { setRole(v); setPage(1); }}>
          <SelectTrigger className="bg-card sm:w-44" aria-label="Role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All roles</SelectItem>
            <SelectItem value="CITIZEN">Landowner</SelectItem>
            {ROLE_OPTIONS.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="bg-card sm:w-40" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Any status</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="DEACTIVATED">Deactivated</SelectItem>
            <SelectItem value="PENDING_VERIFICATION">Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {users.isError ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : (
        <>
          <DataTable columns={columns} data={users.data?.items} loading={users.isLoading} rowLabel={(u) => u.fullName} empty={<EmptyState icon={<Users className="size-6" />} title="No users match" />} />
          <Pagination meta={users.data?.meta} onPage={setPage} />
        </>
      )}
      <SecretReveal open={!!secret} title={secret?.title ?? ''} label="One-time password" secret={secret?.value ?? null} note={secret?.note} onClose={() => setSecret(null)} />
    </>
  );
}

function UserActions({ u, offices, onChanged, onSecret }: { u: AdminUser; offices: LandOffice[]; onChanged: () => void; onSecret: (s: { title: string; value: string; note: string }) => void }) {
  const { user: me } = useAuth();
  const [f, setF] = useState<Form>(() => ({ role: u.role, fullName: u.fullName, phone: u.phone, email: u.email ?? '', officeId: u.officeId ?? 'none', bankCode: u.bankCode ?? '', bankName: u.bankName ?? '' }));
  const [reason, setReason] = useState('');
  const self = me?.userId === u.userId;
  const citizen = u.role === 'CITIZEN';
  const changes: { label: string; value: string }[] = [];
  const body: Record<string, unknown> = {};
  if (f.fullName.trim() !== u.fullName) {
    body.fullName = f.fullName.trim();
    changes.push({ label: 'Name', value: `${u.fullName} → ${f.fullName.trim()}` });
  }
  if (f.email.trim() !== (u.email ?? '')) {
    body.email = f.email.trim();
    changes.push({ label: 'Email', value: f.email.trim() });
  }
  if (f.role !== u.role) {
    body.role = f.role;
    changes.push({ label: 'Role', value: `${ROLE_LABEL[u.role]} → ${ROLE_LABEL[f.role]} (ledger identity re-enrolled)` });
  }
  if ((f.officeId === 'none' ? null : f.officeId) !== u.officeId) {
    body.officeId = f.officeId === 'none' ? null : f.officeId;
    changes.push({ label: 'Office', value: offices.find((o) => o._id === f.officeId)?.name ?? 'None' });
  }
  if (f.role === 'BANK_OFFICER' && (f.bankCode !== (u.bankCode ?? '') || f.bankName !== (u.bankName ?? ''))) {
    body.bankCode = f.bankCode.trim();
    body.bankName = f.bankName.trim();
    changes.push({ label: 'Bank', value: `${f.bankName} (${f.bankCode})` });
  }
  return (
    <div className="flex justify-end gap-1">
      <ConfirmAction
        tier="T1"
        title={`Edit ${u.fullName}`}
        impact={changes}
        consequences={body.role ? ['Their next ledger action enrols a new identity with the new role.'] : []}
        trigger={
          <Button size="icon-sm" variant="ghost" aria-label={`Edit ${u.fullName}`}>
            <Pencil />
          </Button>
        }
        canConfirm={changes.length > 0 && validForm(f, false)}
        confirmLabel="Save"
        successMessage="User updated"
        onConfirm={(ctx) => send('patch', `/admin/users/${u.userId}`, body, { idempotencyKey: ctx.idempotencyKey })}
        onSuccess={onChanged}
      >
        <UserForm f={f} set={setF} offices={offices} creating={false} roleLocked={self || citizen} />
        {(self || citizen) && <p className="text-xs text-muted-foreground">{self ? 'You cannot change your own role.' : 'Landowner accounts cannot become staff accounts.'}</p>}
      </ConfirmAction>
      {u.role !== 'CITIZEN' && u.status === 'ACTIVE' && (
        <ConfirmAction
          tier="T2"
          title={`Reset ${u.fullName}'s password?`}
          consequences={['Their current password stops working immediately.', 'A one-time password is shown once and emailed to them.']}
          typeToConfirm={u.email ?? u.phone}
          trigger={
            <Button size="icon-sm" variant="ghost" aria-label={`Reset password for ${u.fullName}`}>
              <KeyRound />
            </Button>
          }
          confirmLabel="Reset password"
          onConfirm={(ctx) => send<{ temporaryPassword: string }>('post', `/admin/users/${u.userId}/reset-password`, {}, { idempotencyKey: ctx.idempotencyKey })}
          onSuccess={(r) => onSecret({ title: `New password for ${u.fullName}`, value: r.temporaryPassword, note: 'Give this one-time password to the user (it was also emailed).' })}
        />
      )}
      {u.status === 'DEACTIVATED' ? (
        <ConfirmAction
          tier="T1"
          title={`Reactivate ${u.fullName}?`}
          impact={[{ label: 'Status', value: 'Deactivated → Active' }]}
          trigger={
            <Button size="icon-sm" variant="ghost" aria-label={`Reactivate ${u.fullName}`}>
              <ShieldCheck />
            </Button>
          }
          confirmLabel="Reactivate"
          successMessage="User reactivated"
          onConfirm={(ctx) => send('post', `/admin/users/${u.userId}/reactivate`, {}, { idempotencyKey: ctx.idempotencyKey })}
          onSuccess={onChanged}
        />
      ) : (
        !self && (
          <ConfirmAction
            tier="T2"
            title={`Deactivate ${u.fullName}?`}
            consequences={['They can no longer sign in, refresh a session or confirm ledger actions.', 'Linked phones and push tokens are removed.', 'Their records and history are kept (soft delete).']}
            typeToConfirm={u.email ?? u.phone}
            canConfirm={reason.trim().length >= 3}
            trigger={
              <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label={`Deactivate ${u.fullName}`}>
                <ShieldOff />
              </Button>
            }
            confirmLabel="Deactivate"
            successMessage="User deactivated"
            onConfirm={(ctx) => send('post', `/admin/users/${u.userId}/deactivate`, { reason: reason.trim() }, { idempotencyKey: ctx.idempotencyKey })}
            onSuccess={onChanged}
          >
            <Label htmlFor={`deact-${u.userId}`}>Reason</Label>
            <Textarea id={`deact-${u.userId}`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </ConfirmAction>
        )
      )}
    </div>
  );
}
