import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { env, isTest } from './config/env';
import { errorHandler, notFoundHandler } from './core/errors';
import { logger } from './core/logger';
import { authRouter } from './modules/auth/auth.routes';
import { healthRouter } from './modules/health/health.routes';
import { kbRouter } from './modules/kb/kb.routes';
import { supportRouter, ticketRouter } from './modules/support/support.routes';
import { ledgerRouter } from './modules/ledger/ledger.routes';
import { disputeRouter, parcelDisputeRouter } from './modules/disputes/dispute.routes';
import { documentRouter } from './modules/documents/document.routes';
import { statsRouter } from './modules/stats/stats.routes';
import { deviceRouter, notificationRouter } from './modules/notifications/notification.routes';
import { parcelRouter } from './modules/parcels/parcel.routes';
import { transferRouter } from './modules/transfers/transfer.routes';
import { userRouter } from './modules/users/user.routes';
import { verifyRouter } from './modules/verify/verify.routes';

const OPENAPI_PATH = path.resolve(__dirname, '../../docs/openapi.yaml');

function loadOpenApi(): Record<string, unknown> | null {
  try {
    return YAML.parse(readFileSync(OPENAPI_PATH, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function createApp(): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      autoLogging: !isTest,
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      serializers: { req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }) },
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true, exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed', 'X-Content-SHA256', 'X-Ledger-Verified', 'X-Document-Status', 'Content-Disposition'] }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use('/health', healthRouter);
  api.use('/auth', authRouter);
  api.use('/parcels', parcelDisputeRouter);
  api.use('/parcels', parcelRouter);
  api.use('/disputes', disputeRouter);
  api.use('/stats', statsRouter);
  api.use('/ledger', ledgerRouter);
  api.use('/transfers', transferRouter);
  api.use('/documents', documentRouter);
  api.use('/notifications', notificationRouter);
  api.use('/devices', deviceRouter);
  api.use('/users', userRouter);
  api.use('/verify', verifyRouter);
  api.use('/kb', kbRouter);
  api.use('/tickets', ticketRouter);
  api.use('/support', supportRouter);
  app.use('/api/v1', api);

  const spec = loadOpenApi();
  if (spec) {
    app.get('/api/docs/openapi.json', (_req, res) => res.json(spec));
    app.use('/api/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'Milki API' }));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
