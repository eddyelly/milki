import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import { zodToAppError } from './errors';

/** Success envelope `{ data, meta }` (CLAUDE.md §12). */
export function ok<T>(res: Response, data: T, meta: Record<string, unknown> | null = null, status = 200): Response {
  return res.status(status).json({ data, meta });
}

export const created = <T>(res: Response, data: T, meta: Record<string, unknown> | null = null) => ok(res, data, meta, 201);

/** Ledger writes: `202 { txId, status: "SUBMITTED" }`: the commit arrives later over Socket.IO / FCM. */
export function submitted(res: Response, data: { txId: string } & Record<string, unknown>): Response {
  return ok(res, { ...data, status: 'SUBMITTED' }, null, 202);
}

export interface Validated {
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

/** Validates and stores parsed input on `req.valid` (Express 5's req.query is read-only). */
export function validate(schemas: { body?: ZodType; query?: ZodType; params?: ZodType }): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const valid: Validated = {};
    for (const part of ['body', 'query', 'params'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) return next(zodToAppError(result.error));
      valid[part] = result.data;
    }
    req.valid = valid;
    next();
  };
}

/** Typed accessor for validated input. */
export function input<T>(req: Request, part: keyof Validated): T {
  return req.valid?.[part] as T;
}

export interface PageQuery {
  page: number;
  limit: number;
}

export function pageMeta(q: PageQuery, total: number): Record<string, unknown> {
  return { page: q.page, limit: q.limit, total, pages: Math.max(1, Math.ceil(total / q.limit)) };
}
