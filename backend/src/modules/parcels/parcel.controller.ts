import type { Request, Response } from 'express';
import { currentUser } from '../../core/auth';
import { input, ok, pageMeta, submitted } from '../../core/http';
import { audit } from '../audit/audit.model';
import type { ListQuery, RegisterParcelBody, UpdateParcelBody } from './parcel.schema';
import * as svc from './parcel.service';

const pid = (req: Request) => input<{ parcelId: string }>(req, 'params').parcelId;

export async function list(req: Request, res: Response) {
  const q = input<ListQuery>(req, 'query');
  const { items, total } = await svc.list(currentUser(req), q);
  return ok(res, items, { ...pageMeta(q, total), source: 'cache' });
}

export async function get(req: Request, res: Response) {
  return ok(res, await svc.get(currentUser(req), pid(req)), { source: 'ledger' });
}

export async function history(req: Request, res: Response) {
  return ok(res, await svc.history(currentUser(req), pid(req)), { source: 'ledger' });
}

export const related = (kind: 'encumbrances' | 'disputes' | 'transfers' | 'documents') => async (req: Request, res: Response) =>
  ok(res, await svc.related(currentUser(req), pid(req), kind), { source: 'ledger' });

export async function register(req: Request, res: Response) {
  const body = input<RegisterParcelBody>(req, 'body');
  const { txId, ownerId } = await svc.register(currentUser(req), body);
  await audit(req, { action: 'parcel.register', entityType: 'Parcel', entityId: body.parcelId, txId, meta: { ownerId } });
  return submitted(res, { txId, parcelId: body.parcelId });
}

export async function update(req: Request, res: Response) {
  const parcelId = pid(req);
  const body = input<UpdateParcelBody>(req, 'body');
  const { txId } = await svc.update(currentUser(req), parcelId, body);
  await audit(req, { action: 'parcel.update', entityType: 'Parcel', entityId: parcelId, txId, meta: { fields: Object.keys(body) } });
  return submitted(res, { txId, parcelId });
}

const ACTIONS = {
  freeze: ['FreezeParcel', 'parcel.freeze'],
  unfreeze: ['UnfreezeParcel', 'parcel.unfreeze'],
  retire: ['RetireParcel', 'parcel.retire'],
} as const;

export const changeState = (kind: keyof typeof ACTIONS) => async (req: Request, res: Response) => {
  const parcelId = pid(req);
  const { reason } = input<{ reason: string }>(req, 'body');
  const [fn, action] = ACTIONS[kind];
  const { txId } = await svc.changeState(currentUser(req), parcelId, fn, reason);
  await audit(req, { action, entityType: 'Parcel', entityId: parcelId, txId, meta: { reason } });
  return submitted(res, { txId, parcelId });
};
