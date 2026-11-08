'use client';

import { AlarmClock, Flame, Headset, Star } from 'lucide-react';
import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { KpiCard } from '@/components/kpi-card';
import { EmptyState } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { CATEGORY_LABEL, useSupportMetrics, useSupportPresence } from '@/lib/support';

const categoryConfig = { count: { label: 'Tickets', color: 'var(--chart-2)' } } satisfies ChartConfig;
const csatConfig = { average: { label: 'Average stars', color: 'var(--gold)' } } satisfies ChartConfig;

const duration = (minutes: number | null) => (minutes === null ? '-' : minutes < 60 ? `${minutes} min` : `${Math.round((minutes / 60) * 10) / 10} h`);

/** Admin/support metrics (CLAUDE.md §11): open tickets, first response, resolution, CSAT trend, tickets by category. */
export function SupportMetrics() {
  const m = useSupportMetrics(true);
  const d = m.data;
  const online = useSupportPresence() ?? d?.agentsOnline ?? null;
  return (
    <section aria-label="Support" className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold">Support · last {d?.days ?? 30} days</h2>
          <p className="text-sm text-muted-foreground">{online === null ? 'Loading…' : `${online} agent${online === 1 ? '' : 's'} online now`}</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/support">Open queue</Link>
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {!d ? (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)
        ) : (
          <>
            <KpiCard index={0} label="Open tickets" value={d.openTickets} icon={Headset} hint={`${d.byStatus.AWAITING_USER ?? 0} awaiting the user`} />
            <KpiCard index={1} label="SLA breached" value={d.slaBreached} icon={Flame} tone="var(--danger)" hint="Open tickets past their deadline" />
            <Card className="gap-2 p-5">
              <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <AlarmClock className="size-4 text-info" aria-hidden /> Avg first response
              </p>
              <p className="text-3xl font-bold">{duration(d.avgFirstResponseMinutes)}</p>
              <p className="text-xs text-muted-foreground">Resolution: {d.avgResolutionHours === null ? '-' : `${d.avgResolutionHours} h`} on average</p>
            </Card>
            <Card className="gap-2 p-5">
              <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Star className="size-4 text-gold-ink" aria-hidden /> CSAT
              </p>
              <p className="text-3xl font-bold">{d.csat.average === null ? '-' : `${d.csat.average.toFixed(1)} / 5`}</p>
              <p className="text-xs text-muted-foreground">{d.csat.ratings} rating{d.csat.ratings === 1 ? '' : 's'}</p>
            </Card>
          </>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tickets by category</CardTitle>
          </CardHeader>
          <CardContent>
            {!d ? (
              <Skeleton className="h-56" />
            ) : d.byCategory.length === 0 ? (
              <EmptyState title="No tickets in this period" />
            ) : (
              <ChartContainer config={categoryConfig} className="h-56 w-full">
                <BarChart data={d.byCategory.map((c) => ({ ...c, label: CATEGORY_LABEL[c.category] }))} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="label" width={110} tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent hideIndicator />} />
                  <Bar dataKey="count" fill="var(--color-count)" radius={6} maxBarSize={26} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>CSAT trend</CardTitle>
            <CardDescription>Average stars per week</CardDescription>
          </CardHeader>
          <CardContent>
            {!d ? (
              <Skeleton className="h-56" />
            ) : d.csat.trend.length === 0 ? (
              <EmptyState title="No ratings yet" description="Ratings arrive once tickets are resolved." />
            ) : (
              <ChartContainer config={csatConfig} className="h-56 w-full">
                <LineChart data={d.csat.trend} margin={{ left: -12, right: 12 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="week" tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 5]} ticks={[1, 2, 3, 4, 5]} tickLine={false} axisLine={false} width={40} />
                  <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
                  <Line dataKey="average" type="monotone" stroke="var(--color-average)" strokeWidth={2.5} dot={{ r: 4 }} />
                </LineChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
