'use client';

import { ArrowRight, ArrowLeftRight, BadgeCheck, Handshake, Landmark, Map as MapIcon, Receipt, TriangleAlert, X } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from 'recharts';
import { CountUp, KpiCard } from '@/components/kpi-card';
import { EmptyState, ErrorState, PageHeader } from '@/components/page';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import { fmtAgo, fmtArea, ROLE_LABEL, titleCase } from '@/lib/format';
import { useOverview, useParcels } from '@/lib/queries';
import { PARCEL_STATUS } from '@/lib/status';
import { PARCEL_STATUSES, type ParcelSummary } from '@/lib/types';

const monthlyConfig = {
  started: { label: 'Started', color: 'var(--chart-2)' },
  completed: { label: 'Completed', color: 'var(--chart-1)' },
} satisfies ChartConfig;

const regionConfig = { count: { label: 'Parcels', color: 'var(--chart-1)' } } satisfies ChartConfig;

const statusConfig = Object.fromEntries(PARCEL_STATUSES.map((s) => [s, { label: PARCEL_STATUS[s].label, color: PARCEL_STATUS[s].color }])) satisfies ChartConfig;

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Habari za asubuhi' : h < 17 ? 'Habari za mchana' : 'Habari za jioni';
};

export function DashboardView() {
  const { user } = useAuth();
  const overview = useOverview();
  const o = overview.data;
  const role = user?.role;

  const queue =
    role === 'LAND_OFFICER'
      ? [
          { label: 'Awaiting payment confirmation', value: o?.queues.awaitingPayments ?? 0, icon: Receipt, href: '/transfers?status=BUYER_ACCEPTED' },
          { label: 'Awaiting your verification', value: o?.queues.awaitingVerification ?? 0, icon: Handshake, href: '/transfers?status=PAYMENTS_CONFIRMED' },
        ]
      : role === 'REGISTRAR'
        ? [{ label: 'Awaiting your approval', value: o?.queues.awaitingApproval ?? 0, icon: BadgeCheck, href: '/transfers?status=OFFICER_VERIFIED' }]
        : [];

  const openTransfers = o
    ? (o.transfers.byStatus.INITIATED ?? 0) + (o.transfers.byStatus.BUYER_ACCEPTED ?? 0) + (o.transfers.byStatus.PAYMENTS_CONFIRMED ?? 0) + (o.transfers.byStatus.OFFICER_VERIFIED ?? 0)
    : 0;

  return (
    <>
      <PageHeader
        eyebrow={user ? ROLE_LABEL[user.role] : undefined}
        title={`${greeting()}, ${user?.fullName.split(' ')[0] ?? ''}`}
        description="Today’s view of the land register, straight from the ledger caches."
      />

      {overview.isError ? (
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      ) : (
        <div className="space-y-6">
          {queue.length > 0 && (
            <section aria-label="Your work queue" className="grid gap-4 sm:grid-cols-2">
              {queue.map((q, i) => (
                <motion.div key={q.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, duration: 0.3 }}>
                  <Link href={q.href} className="group block rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                    <Card className="flex-row items-center gap-4 border-gold/40 bg-gradient-to-br from-gold/12 to-transparent p-5 shadow-[var(--shadow-raised)] transition-colors group-hover:border-gold">
                      <span className="grid size-12 place-items-center rounded-xl bg-gold/25 text-gold-ink">
                        <q.icon className="size-6" aria-hidden />
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-muted-foreground">{q.label}</p>
                        {overview.isLoading ? <Skeleton className="mt-1 h-8 w-16" /> : <CountUp value={q.value} className="text-3xl font-bold" />}
                      </div>
                      <ArrowRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-1" aria-hidden />
                    </Card>
                  </Link>
                </motion.div>
              ))}
            </section>
          )}

          <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {overview.isLoading || !o ? (
              [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)
            ) : (
              <>
                <KpiCard index={0} label="Registered parcels" value={o.parcels.total} icon={MapIcon} hint={`${o.parcels.byStatus.ACTIVE ?? 0} active`} />
                <KpiCard index={1} label="Open transfers" value={openTransfers} icon={ArrowLeftRight} tone="var(--gold-ink)" hint={`${o.transfers.byStatus.COMPLETED ?? 0} completed in total`} />
                <KpiCard index={2} label="Encumbered" value={o.parcels.byStatus.ENCUMBERED ?? 0} icon={Landmark} tone="var(--info)" hint="Parcels with an active mortgage or charge" />
                <KpiCard index={3} label="Disputed" value={o.parcels.byStatus.DISPUTED ?? 0} icon={TriangleAlert} tone="var(--earth)" hint="Transfers blocked until resolved" />
              </>
            )}
          </section>

          <section className="grid gap-4 lg:grid-cols-3" aria-label="Charts">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Transfers, last 6 months</CardTitle>
                <CardDescription>Started vs completed (ownership moved)</CardDescription>
              </CardHeader>
              <CardContent>
                {!o ? (
                  <Skeleton className="h-64" />
                ) : (
                  <ChartContainer config={monthlyConfig} className="h-64 w-full">
                    <AreaChart data={o.transfers.monthly.map((m) => ({ ...m, label: new Date(`${m.month}-01`).toLocaleString('en', { month: 'short' }) }))} margin={{ left: -12, right: 8 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
                      <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
                      <Area dataKey="started" type="monotone" stroke="var(--color-started)" fill="var(--color-started)" fillOpacity={0.18} strokeWidth={2} />
                      <Area dataKey="completed" type="monotone" stroke="var(--color-completed)" fill="var(--color-completed)" fillOpacity={0.25} strokeWidth={2} />
                      <ChartLegend content={<ChartLegendContent />} />
                    </AreaChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Parcels by status</CardTitle>
                <CardDescription>Every parcel on the register</CardDescription>
              </CardHeader>
              <CardContent>
                {!o ? (
                  <Skeleton className="h-64" />
                ) : o.parcels.total === 0 ? (
                  <EmptyState title="No parcels yet" className="h-64 py-6" />
                ) : (
                  <>
                    <ChartContainer config={statusConfig} className="mx-auto h-48 w-full">
                      <PieChart>
                        <ChartTooltip content={<ChartTooltipContent nameKey="status" hideLabel />} />
                        <Pie
                          data={PARCEL_STATUSES.filter((s) => (o.parcels.byStatus[s] ?? 0) > 0).map((s) => ({ status: s, value: o.parcels.byStatus[s] ?? 0 }))}
                          dataKey="value"
                          nameKey="status"
                          innerRadius={52}
                          outerRadius={80}
                          strokeWidth={2}
                        >
                          {PARCEL_STATUSES.filter((s) => (o.parcels.byStatus[s] ?? 0) > 0).map((s) => (
                            <Cell key={s} fill={PARCEL_STATUS[s].color} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ChartContainer>
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {PARCEL_STATUSES.filter((s) => (o.parcels.byStatus[s] ?? 0) > 0).map((s) => (
                        <li key={s} className="flex items-center gap-1.5 text-xs">
                          <StatusBadge kind="parcel" status={s} size="sm" />
                          <span className="font-mono font-semibold">{o.parcels.byStatus[s]}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Parcels by region</CardTitle>
              </CardHeader>
              <CardContent>
                {!o ? (
                  <Skeleton className="h-56" />
                ) : o.parcels.byRegion.length === 0 ? (
                  <EmptyState title="No parcels yet" />
                ) : (
                  <ChartContainer config={regionConfig} className="w-full" style={{ height: Math.max(120, o.parcels.byRegion.length * 44 + 40) }}>
                    <BarChart data={o.parcels.byRegion} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="region" width={120} tickLine={false} axisLine={false} />
                      <ChartTooltip content={<ChartTooltipContent hideIndicator />} />
                      <Bar dataKey="count" fill="var(--color-count)" radius={6} maxBarSize={28} />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
          </section>

          <RecentParcels />
        </div>
      )}
    </>
  );
}

/** Parcel card → details with a shared-element `layoutId` transition (CLAUDE.md §10.5). */
function RecentParcels() {
  const { data, isLoading } = useParcels({ limit: 6, sort: '-updatedAt' });
  const [selected, setSelected] = useState<ParcelSummary | null>(null);
  const reduce = useReducedMotion();

  return (
    <section aria-labelledby="recent-heading" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 id="recent-heading" className="text-lg font-semibold">
          Recently updated parcels
        </h2>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/parcels">
            All parcels <ArrowRight />
          </Link>
        </Button>
      </div>
      <LayoutGroup>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
          {data?.items.length === 0 && <EmptyState title="No parcels on the register yet" className="sm:col-span-3" />}
          {data?.items.map((p) => (
            <motion.button
              key={p.parcelId}
              layoutId={reduce ? undefined : `parcel-${p.parcelId}`}
              onClick={() => setSelected(p)}
              className="rounded-xl border bg-card p-4 text-left shadow-[var(--shadow-raised)] transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              aria-label={`Preview parcel ${p.parcelId}`}
            >
              <div className="flex items-start justify-between gap-2">
                <motion.span layoutId={reduce ? undefined : `parcel-id-${p.parcelId}`} className="font-mono text-sm font-semibold">
                  {p.parcelId}
                </motion.span>
                <StatusBadge kind="parcel" status={p.status} size="sm" />
              </div>
              <p className="mt-2 text-sm">
                {p.ward}, {p.district}
              </p>
              <p className="text-xs text-muted-foreground">
                {p.region} · {fmtArea(p.area)} · {fmtAgo(p.ledgerUpdatedAt)}
              </p>
            </motion.button>
          ))}
        </div>
        <AnimatePresence>
          {selected && (
            <>
              <motion.div
                key="backdrop"
                className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setSelected(null)}
              />
              <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
                <motion.div
                  layoutId={reduce ? undefined : `parcel-${selected.parcelId}`}
                  role="dialog"
                  aria-modal="true"
                  aria-label={`Parcel ${selected.parcelId}`}
                  className="pointer-events-auto w-full max-w-lg rounded-xl border bg-card p-6 shadow-2xl"
                  onKeyDown={(e) => e.key === 'Escape' && setSelected(null)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <motion.p layoutId={reduce ? undefined : `parcel-id-${selected.parcelId}`} className="font-mono text-lg font-bold">
                        {selected.parcelId}
                      </motion.p>
                      <p className="text-sm text-muted-foreground">Title {selected.titleNumber}</p>
                    </div>
                    <Button variant="ghost" size="icon" aria-label="Close preview" onClick={() => setSelected(null)} autoFocus>
                      <X />
                    </Button>
                  </div>
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.15 } }} className="mt-4 space-y-4">
                    <StatusBadge kind="parcel" status={selected.status} />
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">Location</dt>
                        <dd className="font-medium">
                          {selected.ward}, {selected.district}, {selected.region}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Area</dt>
                        <dd className="font-medium">{fmtArea(selected.area)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Land use</dt>
                        <dd className="font-medium">{titleCase(selected.landUse)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Last change</dt>
                        <dd className="font-medium">{fmtAgo(selected.ledgerUpdatedAt)}</dd>
                      </div>
                    </dl>
                    <Button asChild className="w-full">
                      <Link href={`/parcels/${selected.parcelId}`}>
                        Open full record <ArrowRight />
                      </Link>
                    </Button>
                  </motion.div>
                </motion.div>
              </div>
            </>
          )}
        </AnimatePresence>
      </LayoutGroup>
    </section>
  );
}
