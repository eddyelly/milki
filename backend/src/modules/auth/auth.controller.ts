import type { CookieOptions, Request, Response } from 'express';
import { isProd } from '../../config/env';
import { currentUser } from '../../core/auth';
import { created, input, ok } from '../../core/http';
import { audit } from '../audit/audit.model';
import type { EnrollDeviceInput, LoginInput, OtpInput, ReauthInput, RegisterInput } from './auth.schema';
import * as auth from './auth.service';
import { resendOtp } from './otp.service';

/** The web portal keeps the refresh token in an httpOnly cookie; the mobile app uses the body field. */
const REFRESH_COOKIE = 'milki_rt';
const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'strict',
  path: '/api/v1/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const refreshTokenFrom = (req: Request): string | undefined =>
  (req.body as { refreshToken?: string } | undefined)?.refreshToken ?? (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];

function sendSession(res: Response, session: auth.Session): Response {
  res.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions);
  return ok(res, session);
}

export async function register(req: Request, res: Response) {
  const result = await auth.register(input<RegisterInput>(req, 'body'));
  await audit(req, { action: 'auth.register', entityType: 'User', entityId: result.userId, actor: { userId: result.userId, role: 'CITIZEN' } });
  return created(res, result);
}

export async function login(req: Request, res: Response) {
  try {
    return ok(res, await auth.login(input<LoginInput>(req, 'body')));
  } catch (err) {
    await audit(req, { action: 'auth.login', outcome: 'FAILURE', meta: { reason: (err as { code?: string }).code ?? 'ERROR' } });
    throw err;
  }
}

export async function verifyOtp(req: Request, res: Response) {
  const session = await auth.completeOtp(input<OtpInput>(req, 'body'));
  await audit(req, { action: 'auth.session.start', entityType: 'User', entityId: session.user.userId, actor: { userId: session.user.userId, role: session.user.role } });
  return sendSession(res, session);
}

export async function resend(req: Request, res: Response) {
  return ok(res, await resendOtp(input<{ challengeId: string }>(req, 'body').challengeId));
}

export async function refresh(req: Request, res: Response) {
  return sendSession(res, await auth.refresh(refreshTokenFrom(req)));
}

export async function logout(req: Request, res: Response) {
  await auth.logout(refreshTokenFrom(req));
  res.clearCookie(REFRESH_COOKIE, { path: cookieOptions.path });
  await audit(req, { action: 'auth.logout' });
  return ok(res, { signedOut: true });
}

export async function me(req: Request, res: Response) {
  return ok(res, await auth.me(currentUser(req).userId));
}

export async function reauthOtp(req: Request, res: Response) {
  return ok(res, await auth.requestReauthOtp(currentUser(req).userId));
}

export async function reauth(req: Request, res: Response) {
  const user = currentUser(req);
  try {
    const result = await auth.reauthenticate(user.userId, input<ReauthInput>(req, 'body'));
    await audit(req, { action: 'auth.reauth' });
    return ok(res, result);
  } catch (err) {
    await audit(req, { action: 'auth.reauth', outcome: 'FAILURE' });
    throw err;
  }
}

export async function enrollDevice(req: Request, res: Response) {
  const user = currentUser(req);
  const body = input<EnrollDeviceInput>(req, 'body');
  try {
    const result = await auth.enrollReauthDevice(user.userId, body);
    await audit(req, { action: 'auth.reauthDevice.enroll', entityType: 'ReauthDevice', entityId: body.deviceId });
    return ok(res, result);
  } catch (err) {
    await audit(req, { action: 'auth.reauthDevice.enroll', outcome: 'FAILURE', entityId: body.deviceId });
    throw err;
  }
}

export async function revokeDevice(req: Request, res: Response) {
  const { deviceId } = input<{ deviceId: string }>(req, 'params');
  const revoked = await auth.revokeReauthDevice(currentUser(req).userId, deviceId);
  await audit(req, { action: 'auth.reauthDevice.revoke', entityType: 'ReauthDevice', entityId: deviceId });
  return ok(res, { revoked });
}
