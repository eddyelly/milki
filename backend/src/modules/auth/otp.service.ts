import { randomInt } from 'node:crypto';
import { randomToken, safeEqual, sha256Hex } from '../../core/crypto';
import { redis } from '../../core/datastores';
import { AppError, badRequest } from '../../core/errors';
import { notify } from '../../core/notify';

export type OtpPurpose = 'REGISTER' | 'LOGIN' | 'REAUTH';

export const OTP_TTL_SECONDS = 300; // CLAUDE.md §12: 5-minute TTL
const MAX_ATTEMPTS = 5;

interface Challenge {
  userId: string;
  purpose: OtpPurpose;
  codeHash: string;
  attempts: number;
  phone: string;
}

const key = (id: string) => `otp:${id}`;
const hashCode = (challengeId: string, code: string) => sha256Hex(`${challengeId}:${code}`);

export const maskPhone = (phone: string): string => `${phone.slice(0, 4)}•••••${phone.slice(-3)}`;

const MESSAGES: Record<OtpPurpose, (code: string) => string> = {
  REGISTER: (c) => `Milki: your verification code is ${c}. It expires in 5 minutes. Never share it.`,
  LOGIN: (c) => `Milki: your sign-in code is ${c}. It expires in 5 minutes. Never share it.`,
  REAUTH: (c) => `Milki: your confirmation code for a land register action is ${c}. If this wasn't you, contact support.`,
};

/** Creates a one-time code, stores only its hash in Redis (5 min) and sends it by SMS. */
export async function issueOtp(userId: string, phone: string, purpose: OtpPurpose): Promise<{ challengeId: string; sentTo: string; expiresIn: number }> {
  const challengeId = randomToken(16);
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const challenge: Challenge = { userId, purpose, codeHash: hashCode(challengeId, code), attempts: 0, phone };
  await redis.set(key(challengeId), JSON.stringify(challenge), 'EX', OTP_TTL_SECONDS);
  await notify.sms(phone, MESSAGES[purpose](code));
  return { challengeId, sentTo: maskPhone(phone), expiresIn: OTP_TTL_SECONDS };
}

/** Re-sends a fresh code for an existing challenge (new challenge ID; the old one stops working). */
export async function resendOtp(challengeId: string): Promise<{ challengeId: string; sentTo: string; expiresIn: number }> {
  const raw = await redis.get(key(challengeId));
  if (!raw) throw badRequest('This code has expired. Please start again.', undefined, 'OTP_EXPIRED');
  const c = JSON.parse(raw) as Challenge;
  await redis.del(key(challengeId));
  return issueOtp(c.userId, c.phone, c.purpose);
}

/** Verifies a code. Single use; at most 5 wrong attempts per challenge. Returns the user it belongs to. */
export async function verifyOtp(challengeId: string, code: string, expected: OtpPurpose | OtpPurpose[]): Promise<{ userId: string; purpose: OtpPurpose }> {
  const raw = await redis.get(key(challengeId));
  if (!raw) throw badRequest('This code has expired. Please request a new one.', undefined, 'OTP_EXPIRED');
  const c = JSON.parse(raw) as Challenge;
  const purposes = Array.isArray(expected) ? expected : [expected];
  if (!purposes.includes(c.purpose)) throw badRequest('This code cannot be used here.', undefined, 'OTP_INVALID');

  if (!safeEqual(c.codeHash, hashCode(challengeId, code))) {
    c.attempts += 1;
    if (c.attempts >= MAX_ATTEMPTS) {
      await redis.del(key(challengeId));
      throw new AppError(429, 'OTP_LOCKED', 'Too many wrong codes. Please request a new one.');
    }
    const ttl = await redis.ttl(key(challengeId));
    await redis.set(key(challengeId), JSON.stringify(c), 'EX', Math.max(ttl, 1));
    throw badRequest(`That code is not correct. ${MAX_ATTEMPTS - c.attempts} attempt(s) left.`, undefined, 'OTP_INVALID');
  }
  await redis.del(key(challengeId));
  return { userId: c.userId, purpose: c.purpose };
}
