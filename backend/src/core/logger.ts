import pino from 'pino';
import { env } from '../config/env';

/**
 * Never log tokens, keys or PII (CLAUDE.md §12). Redaction covers the usual places these travel;
 * code must still avoid putting them in log messages.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'milki-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'req.headers["x-reauth-token"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.nida',
      '*.phone',
      '*.code',
      '*.otp',
      '*.accessToken',
      '*.refreshToken',
      '*.reauthToken',
      '*.privateKey',
      '*.privateKeyPem',
    ],
    censor: '[redacted]',
  },
});
