import { type Request, type Response, Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { currentUser, optionalAuth, requireAuth, requireRole } from '../../core/auth';
import { piiHash } from '../../core/crypto';
import { conflict, notFound } from '../../core/errors';
import { created, input, ok, pageMeta, validate } from '../../core/http';
import { idempotent } from '../../core/idempotency';
import { audit } from '../audit/audit.model';
import { KbArticle, KbCategory, KbVote } from './kb.models';

/**
 * Help centre (CLAUDE.md §11). Reading and voting are public; support agents and admins manage articles
 * (T1 create/update, T2 unpublish/delete — the UI enforces the tiers, the API is idempotent).
 */
export const kbRouter = Router();
const EDITORS = ['SUPPORT_AGENT', 'SYSTEM_ADMIN'] as const;
const isEditor = (req: Request) => !!req.user && (EDITORS as readonly string[]).includes(req.user.role);

const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase words joined by hyphens.').max(80);
const localized = (max: number) => z.object({ en: z.string().trim().min(1).max(max), sw: z.string().trim().min(1).max(max) });
const objectId = z.string().refine(isValidObjectId, 'Not a valid ID.');

// ------------------------------------------------------------------------------------- categories
kbRouter.get('/categories', async (_req: Request, res: Response) => {
  const cats = await KbCategory.find({ deletedAt: null }).sort({ order: 1, slug: 1 }).lean();
  const counts = await KbArticle.aggregate<{ _id: string; n: number }>([{ $match: { status: 'PUBLISHED', deletedAt: null } }, { $group: { _id: '$categorySlug', n: { $sum: 1 } } }]);
  const byCat = new Map(counts.map((c) => [c._id, c.n]));
  return ok(res, cats.map((c) => ({ ...c, articleCount: byCat.get(c.slug) ?? 0 })));
});

const categoryBody = z.object({ slug, name: localized(80), icon: z.string().trim().max(40).optional(), order: z.number().int().min(0).max(1000).optional() });

kbRouter.post('/categories', requireAuth, requireRole(...EDITORS), idempotent, validate({ body: categoryBody }), async (req: Request, res: Response) => {
  const body = input<z.infer<typeof categoryBody>>(req, 'body');
  if (await KbCategory.exists({ slug: body.slug })) throw conflict('A category with that slug already exists.');
  const c = await KbCategory.create(body);
  await audit(req, { action: 'kb.category.create', entityType: 'KbCategory', entityId: c.slug });
  return created(res, c.toObject());
});

kbRouter.patch('/categories/:id', requireAuth, requireRole(...EDITORS), idempotent, validate({ params: z.object({ id: objectId }), body: categoryBody.partial().omit({ slug: true }) }), async (req: Request, res: Response) => {
  const c = await KbCategory.findOneAndUpdate({ _id: input<{ id: string }>(req, 'params').id, deletedAt: null }, { $set: input(req, 'body') }, { returnDocument: 'after' }).lean();
  if (!c) throw notFound('Category not found.');
  await audit(req, { action: 'kb.category.update', entityType: 'KbCategory', entityId: c.slug });
  return ok(res, c);
});

kbRouter.delete('/categories/:id', requireAuth, requireRole(...EDITORS), idempotent, validate({ params: z.object({ id: objectId }) }), async (req: Request, res: Response) => {
  const c = await KbCategory.findOne({ _id: input<{ id: string }>(req, 'params').id, deletedAt: null });
  if (!c) throw notFound('Category not found.');
  if (await KbArticle.exists({ categorySlug: c.slug, deletedAt: null })) throw conflict('Move or delete the articles in this category first.', null, 'CATEGORY_NOT_EMPTY');
  c.deletedAt = new Date();
  await c.save();
  await audit(req, { action: 'kb.category.delete', entityType: 'KbCategory', entityId: c.slug });
  return ok(res, { deleted: true });
});

// --------------------------------------------------------------------------------------- articles
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(80).optional(),
  status: z.enum(['PUBLISHED', 'DRAFT', 'ALL']).default('PUBLISHED'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

kbRouter.get('/articles', optionalAuth, validate({ query: listQuery }), async (req: Request, res: Response) => {
  const q = input<z.infer<typeof listQuery>>(req, 'query');
  const status = isEditor(req) ? q.status : 'PUBLISHED';
  const filter: Record<string, unknown> = { deletedAt: null, ...(status === 'ALL' ? {} : { status }) };
  if (q.category) filter.categorySlug = q.category;
  if (q.q) filter.$text = { $search: q.q };
  const sort: Record<string, 1 | -1 | { $meta: 'textScore' }> = q.q ? { score: { $meta: 'textScore' } } : { helpfulYes: -1, views: -1, slug: 1 };
  const [items, total] = await Promise.all([
    KbArticle.find(filter, q.q ? { score: { $meta: 'textScore' } } : {})
      .sort(sort)
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    KbArticle.countDocuments(filter),
  ]);
  return ok(res, items, pageMeta(q, total));
});

kbRouter.get('/articles/:slug', optionalAuth, validate({ params: z.object({ slug }) }), async (req: Request, res: Response) => {
  const s = input<{ slug: string }>(req, 'params').slug;
  const filter: Record<string, unknown> = { slug: s, deletedAt: null, ...(isEditor(req) ? {} : { status: 'PUBLISHED' }) };
  const a = await KbArticle.findOneAndUpdate(filter, { $inc: { views: 1 } }, { returnDocument: 'after' }).lean();
  if (!a) throw notFound('That help article was not found.');
  return ok(res, a);
});

/** "Was this helpful?" — public, one vote per reader (changing your vote moves it). */
kbRouter.post(
  '/articles/:slug/vote',
  rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }),
  optionalAuth,
  validate({ params: z.object({ slug }), body: z.object({ helpful: z.boolean() }) }),
  async (req: Request, res: Response) => {
    const a = await KbArticle.findOne({ slug: input<{ slug: string }>(req, 'params').slug, status: 'PUBLISHED', deletedAt: null });
    if (!a) throw notFound('That help article was not found.');
    const { helpful } = input<{ helpful: boolean }>(req, 'body');
    const voterKey = req.user ? `u:${req.user.userId}` : `ip:${piiHash(req.ip ?? 'unknown')}`;
    const prev = await KbVote.findOneAndUpdate({ articleId: a._id, voterKey }, { helpful }, { upsert: true, returnDocument: 'before' }).lean();
    if (!prev || prev.helpful !== helpful) {
      const inc: Record<string, number> = { [helpful ? 'helpfulYes' : 'helpfulNo']: 1 };
      if (prev) inc[prev.helpful ? 'helpfulYes' : 'helpfulNo'] = -1;
      await KbArticle.updateOne({ _id: a._id }, { $inc: inc });
    }
    const fresh = await KbArticle.findById(a._id, { helpfulYes: 1, helpfulNo: 1 }).lean();
    return ok(res, { helpful, helpfulYes: fresh?.helpfulYes ?? 0, helpfulNo: fresh?.helpfulNo ?? 0 });
  },
);

const articleBody = z.object({
  slug,
  categorySlug: z.string().trim().min(1).max(80),
  title: localized(160),
  body: localized(20_000),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(10).default([]),
  status: z.enum(['DRAFT', 'PUBLISHED']).default('DRAFT'),
});

async function assertCategory(slugValue: string | undefined): Promise<void> {
  if (slugValue && !(await KbCategory.exists({ slug: slugValue, deletedAt: null }))) throw notFound('That category does not exist.', 'CATEGORY_NOT_FOUND');
}

kbRouter.post('/articles', requireAuth, requireRole(...EDITORS), idempotent, validate({ body: articleBody }), async (req: Request, res: Response) => {
  const body = input<z.infer<typeof articleBody>>(req, 'body');
  await assertCategory(body.categorySlug);
  if (await KbArticle.exists({ slug: body.slug })) throw conflict('An article with that slug already exists.');
  const a = await KbArticle.create({ ...body, createdBy: currentUser(req).userId, publishedAt: body.status === 'PUBLISHED' ? new Date() : null });
  await audit(req, { action: 'kb.article.create', entityType: 'KbArticle', entityId: a.slug, meta: { status: a.status } });
  return created(res, a.toObject());
});

const idParams = z.object({ id: objectId });

kbRouter.patch('/articles/:id', requireAuth, requireRole(...EDITORS), idempotent, validate({ params: idParams, body: articleBody.partial().omit({ slug: true }) }), async (req: Request, res: Response) => {
  const body = input<Partial<z.infer<typeof articleBody>>>(req, 'body');
  await assertCategory(body.categorySlug);
  const a = await KbArticle.findOne({ _id: input<{ id: string }>(req, 'params').id, deletedAt: null });
  if (!a) throw notFound('Article not found.');
  const wasPublished = a.status === 'PUBLISHED';
  a.set({ ...body, updatedBy: currentUser(req).userId });
  if (!wasPublished && a.status === 'PUBLISHED') a.publishedAt = new Date();
  await a.save();
  await audit(req, { action: a.status !== (wasPublished ? 'PUBLISHED' : 'DRAFT') ? (a.status === 'PUBLISHED' ? 'kb.article.publish' : 'kb.article.unpublish') : 'kb.article.update', entityType: 'KbArticle', entityId: a.slug });
  return ok(res, a.toObject());
});

/** Soft delete (CLAUDE.md rule 8). */
kbRouter.delete('/articles/:id', requireAuth, requireRole(...EDITORS), idempotent, validate({ params: idParams }), async (req: Request, res: Response) => {
  const a = await KbArticle.findOneAndUpdate({ _id: input<{ id: string }>(req, 'params').id, deletedAt: null }, { deletedAt: new Date(), status: 'DRAFT' }, { returnDocument: 'after' }).lean();
  if (!a) throw notFound('Article not found.');
  await audit(req, { action: 'kb.article.delete', entityType: 'KbArticle', entityId: a.slug });
  return ok(res, { deleted: true });
});
