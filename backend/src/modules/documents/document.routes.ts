import { type Request, type Response, Router } from 'express';
import multer from 'multer';
import { currentUser, requireAuth, requireReauth, requireRole } from '../../core/auth';
import { input, ok, submitted, validate } from '../../core/http';
import { idempotent } from '../../core/idempotency';
import { audit } from '../audit/audit.model';
import { documentParams, supersedeBody, uploadBody, type UploadBody } from './document.schema';
import * as svc from './document.service';

export const documentRouter = Router();
documentRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: svc.MAX_FILE_BYTES, files: 1, fields: 10 } }).single('file');
const did = (req: Request) => input<{ documentId: string }>(req, 'params').documentId;

/** Attaching a document writes its hash to the ledger, so it is a T3 action. */
const t3 = [requireRole('CITIZEN', 'LAND_OFFICER', 'REGISTRAR', 'BANK_OFFICER'), idempotent, requireReauth, upload] as const;

documentRouter.post('/', ...t3, validate({ body: uploadBody }), async (req: Request, res: Response) => {
  const body = input<UploadBody>(req, 'body');
  const r = await svc.upload(currentUser(req), req.file, body);
  await audit(req, {
    action: 'document.attach',
    entityType: 'Document',
    entityId: r.documentId,
    txId: r.txId,
    meta: { targetType: body.targetType, targetId: body.targetId, documentType: body.documentType, sha256: r.sha256 },
  });
  return submitted(res, r);
});

documentRouter.post('/:documentId/supersede', ...t3, validate({ params: documentParams, body: supersedeBody }), async (req: Request, res: Response) => {
  const r = await svc.supersede(currentUser(req), did(req), req.file, input<{ sha256?: string }>(req, 'body').sha256);
  await audit(req, { action: 'document.supersede', entityType: 'Document', entityId: r.documentId, txId: r.txId, meta: { supersedes: r.supersedes, sha256: r.sha256 } });
  return submitted(res, r);
});

/** Download, only after the bytes are re-verified against the ledger hash. */
documentRouter.get('/:documentId/download', validate({ params: documentParams }), async (req: Request, res: Response) => {
  const { data, sha, meta, ledger } = await svc.download(currentUser(req), did(req));
  const name = (meta.originalName ?? `${meta.documentId}`).replace(/[^\w.\- ]/g, '_');
  res.setHeader('Content-Type', meta.mimeType);
  res.setHeader('Content-Length', String(data.length));
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('X-Content-SHA256', sha);
  res.setHeader('X-Ledger-Verified', 'true');
  res.setHeader('X-Document-Status', ledger.status);
  res.setHeader('Access-Control-Expose-Headers', 'X-Content-SHA256, X-Ledger-Verified, X-Document-Status, Content-Disposition');
  res.end(data);
});

/** Check a file you hold against the ledger (no write; no re-auth needed). */
documentRouter.post(
  '/:documentId/verify',
  multer({ storage: multer.memoryStorage(), limits: { fileSize: svc.MAX_FILE_BYTES, files: 1 } }).single('file'),
  validate({ params: documentParams }),
  async (req: Request, res: Response) => ok(res, await svc.verifyFile(currentUser(req), did(req), req.file), { source: 'ledger' }),
);
