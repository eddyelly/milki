import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { randomToken } from './crypto';
import { redis } from './datastores';
import { forbidden, unauthorized } from './errors';
import { ROLES, type Role } from './roles';

export interface AuthUser {
  userId: string;
  role: Role;
}

const ISSUER = 'milki';
const AUDIENCE = 'milki-api';

interface AccessClaims {
  sub: string;
  role: Role;
  typ: 'access';
}
interface RefreshClaims {
  sub: string;
  jti: string;
  typ: 'refresh';
  exp: number;
}
interface ReauthClaims {
  sub: string;
  jti: string;
  typ: 'reauth';
  exp: number;
}

const sign = (payload: object, secret: string, expiresIn: string): string =>
  jwt.sign(payload, secret, { issuer: ISSUER, audience: AUDIENCE, expiresIn: expiresIn as SignOptions['expiresIn'] });

function verify<T>(token: string, secret: string): T | null {
  try {
    return jwt.verify(token, secret, { issuer: ISSUER, audience: AUDIENCE }) as T;
  } catch {
    return null;
  }
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: string;
}

export function issueTokens(user: AuthUser): TokenPair {
  const accessToken = sign({ sub: user.userId, role: user.role, typ: 'access' }, env.JWT_ACCESS_SECRET, env.JWT_ACCESS_TTL);
  const refreshToken = sign({ sub: user.userId, jti: randomToken(16), typ: 'refresh' }, env.JWT_REFRESH_SECRET, env.JWT_REFRESH_TTL);
  return { accessToken, refreshToken, accessExpiresIn: env.JWT_ACCESS_TTL };
}

export function verifyAccessToken(token: string): AuthUser | null {
  const claims = verify<AccessClaims>(token, env.JWT_ACCESS_SECRET);
  if (!claims || claims.typ !== 'access' || !(ROLES as readonly string[]).includes(claims.role)) return null;
  return { userId: claims.sub, role: claims.role };
}

const denyKey = (jti: string) => `auth:rt:deny:${jti}`;

/** Marks a refresh token as used/revoked until it would have expired anyway. */
async function denyRefresh(claims: RefreshClaims): Promise<void> {
  const ttl = Math.max(1, claims.exp - Math.floor(Date.now() / 1000));
  await redis.set(denyKey(claims.jti), '1', 'EX', ttl);
}

/**
 * Rotation: a refresh token works once. Returns the subject so the caller can re-check the user and issue
 * a new pair. A replayed (denylisted) token is rejected.
 */
export async function consumeRefreshToken(token: string): Promise<string> {
  const claims = verify<RefreshClaims>(token, env.JWT_REFRESH_SECRET);
  if (!claims || claims.typ !== 'refresh') throw unauthorized('Your session has expired. Please sign in again.', 'SESSION_EXPIRED');
  const fresh = await redis.set(denyKey(claims.jti), '1', 'EX', Math.max(1, claims.exp - Math.floor(Date.now() / 1000)), 'NX');
  if (fresh !== 'OK') throw unauthorized('This session was already used or signed out. Please sign in again.', 'SESSION_REVOKED');
  return claims.sub;
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const claims = verify<RefreshClaims>(token, env.JWT_REFRESH_SECRET);
  if (claims?.typ === 'refresh') await denyRefresh(claims);
}

// ---------------------------------------------------------------------------------------------
// Re-authentication for T3 (ledger) actions — CLAUDE.md §8
// ---------------------------------------------------------------------------------------------
export const REAUTH_TTL_SECONDS = 300;

export function issueReauthToken(userId: string): string {
  return sign({ sub: userId, jti: randomToken(16), typ: 'reauth' }, env.JWT_ACCESS_SECRET, `${REAUTH_TTL_SECONDS}s`);
}

/** Requires a fresh, single-use `X-Reauth-Token` for the signed-in user. */
export const requireReauth: RequestHandler = async (req: Request, _res: Response, next: NextFunction) => {
  const token = req.header('x-reauth-token');
  const claims = token ? verify<ReauthClaims>(token, env.JWT_ACCESS_SECRET) : null;
  if (!claims || claims.typ !== 'reauth' || claims.sub !== req.user?.userId) {
    return next(unauthorized('Please confirm it is you before writing to the land register.', 'REAUTH_REQUIRED'));
  }
  const first = await redis.set(`auth:reauth:used:${claims.jti}`, '1', 'EX', REAUTH_TTL_SECONDS + 60, 'NX');
  if (first !== 'OK') return next(unauthorized('This confirmation was already used. Please confirm again.', 'REAUTH_REQUIRED'));
  next();
};

// ---------------------------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------------------------
/** Public routes that behave differently for signed-in staff (e.g. the help centre showing drafts). */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  const header = req.header('authorization') ?? '';
  const user = header.startsWith('Bearer ') ? verifyAccessToken(header.slice(7)) : null;
  if (user) req.user = user;
  next();
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = token ? verifyAccessToken(token) : null;
  if (!user) return next(unauthorized());
  req.user = user;
  next();
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden('Your role does not allow this action.'));
    next();
  };
}

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
