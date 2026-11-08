import type { Validated } from '../core/http';
import type { AuthUser } from '../core/auth';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth. */
      user?: AuthUser;
      /** Set by validate(). */
      valid?: Validated;
      /** Set by the partner API-key middleware (CLAUDE.md §12, /api/v1/partner). */
      partner?: { clientId: string; name: string; bankCode: string; bankName: string; scopes: string[]; rateLimitPerMin: number };
    }
  }
}

export {};
