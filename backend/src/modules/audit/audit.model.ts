import type { Request } from 'express';
import { model, Schema } from 'mongoose';
import { logger } from '../../core/logger';

const auditSchema = new Schema(
  {
    at: { type: Date, default: () => new Date(), index: true },
    actor: { userId: String, role: String },
    action: { type: String, required: true, index: true },
    entityType: { type: String, index: true },
    entityId: { type: String, index: true },
    txId: { type: String, index: true },
    outcome: { type: String, enum: ['SUCCESS', 'FAILURE'], default: 'SUCCESS' },
    ip: String,
    requestId: String,
    /** Must never contain PII, tokens or keys. */
    meta: { type: Schema.Types.Mixed },
  },
  { versionKey: false },
);

export const AuditLog = model('AuditLog', auditSchema);

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string;
  txId?: string;
  outcome?: 'SUCCESS' | 'FAILURE';
  actor?: { userId: string; role: string } | null;
  meta?: Record<string, unknown>;
}

/** Append-only audit trail (every mutation). Never throws — a failed audit write is logged, not surfaced. */
export async function audit(req: Request | null, entry: AuditEntry): Promise<void> {
  try {
    await AuditLog.create({
      ...entry,
      actor: entry.actor ?? (req?.user ? { userId: req.user.userId, role: req.user.role } : null),
      ip: req?.ip,
      requestId: req ? String(req.id ?? '') : undefined,
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, 'audit write failed');
  }
}
