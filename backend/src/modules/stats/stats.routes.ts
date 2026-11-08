import { type Request, type Response, Router } from 'express';
import { currentUser, requireAuth, requireRole } from '../../core/auth';
import { redis } from '../../core/datastores';
import { ok } from '../../core/http';
import { STAFF_ROLES } from '../../core/roles';
import { ParcelCache } from '../parcels/parcel-cache.model';
import { Escalation, Ticket } from '../support/support.models';
import { TransferCache } from '../transfers/transfer-cache.model';

export const statsRouter = Router();
statsRouter.use(requireAuth, requireRole(...STAFF_ROLES));

const countBy = async (model: typeof ParcelCache | typeof TransferCache, field: string) =>
  Object.fromEntries(
    (await (model as typeof ParcelCache).aggregate<{ _id: string; n: number }>([{ $group: { _id: `$${field}`, n: { $sum: 1 } } }])).map((r) => [r._id ?? 'UNKNOWN', r.n]),
  );

/** Dashboard KPIs from the caches (hot-cached in Redis for 60 s, CLAUDE.md §12). */
async function overview() {
  const since = new Date();
  since.setMonth(since.getMonth() - 5, 1);
  since.setHours(0, 0, 0, 0);
  const [parcelsByStatus, transfersByStatus, parcelsByRegion, monthly, parcelsTotal, transfersTotal] = await Promise.all([
    countBy(ParcelCache, 'status'),
    countBy(TransferCache, 'status'),
    ParcelCache.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$region', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 8 }]),
    TransferCache.aggregate<{ _id: string; started: number; completed: number }>([
      { $match: { ledgerCreatedAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$ledgerCreatedAt' } },
          started: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    ParcelCache.countDocuments(),
    TransferCache.countDocuments(),
  ]);
  const [unassigned, openTickets, openEscalations] = await Promise.all([
    Ticket.countDocuments({ deletedAt: null, assigneeId: null, status: { $in: ['OPEN', 'IN_PROGRESS', 'AWAITING_USER'] } }),
    Ticket.countDocuments({ deletedAt: null, status: { $in: ['OPEN', 'IN_PROGRESS', 'AWAITING_USER'] } }),
    Escalation.countDocuments({ status: 'OPEN' }),
  ]);
  // Every one of the last 6 months appears, even with no activity.
  const months: { month: string; started: number; completed: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(since);
    d.setMonth(since.getMonth() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const hit = monthly.find((m) => m._id === key);
    months.push({ month: key, started: hit?.started ?? 0, completed: hit?.completed ?? 0 });
  }
  return {
    parcels: { total: parcelsTotal, byStatus: parcelsByStatus, byRegion: parcelsByRegion.map((r) => ({ region: r._id, count: r.n })) },
    transfers: { total: transfersTotal, byStatus: transfersByStatus, monthly: months },
    queues: {
      awaitingPayments: transfersByStatus.BUYER_ACCEPTED ?? 0,
      awaitingVerification: transfersByStatus.PAYMENTS_CONFIRMED ?? 0,
      awaitingApproval: transfersByStatus.OFFICER_VERIFIED ?? 0,
    },
    support: { unassigned, openTickets, openEscalations },
    generatedAt: new Date().toISOString(),
  };
}

statsRouter.get('/overview', async (req: Request, res: Response) => {
  currentUser(req);
  const cached = await redis.get('stats:overview');
  if (cached) return ok(res, JSON.parse(cached) as unknown, { cached: true });
  const data = await overview();
  await redis.set('stats:overview', JSON.stringify(data), 'EX', 60);
  return ok(res, data, { cached: false });
});
