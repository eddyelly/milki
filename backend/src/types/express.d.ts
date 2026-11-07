import type { Validated } from '../core/http';
import type { AuthUser } from '../core/auth';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth. */
      user?: AuthUser;
      /** Set by validate(). */
      valid?: Validated;
    }
  }
}

export {};
