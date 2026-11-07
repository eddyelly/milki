import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect } from 'vitest';
import { createApp } from '../src/app';
import { issueTokens } from '../src/core/auth';
import { piiHash } from '../src/core/crypto';
import type { Role } from '../src/core/roles';
import { hashPassword } from '../src/modules/auth/auth.service';
import { User } from '../src/modules/users/user.model';
import { newUserId } from '../src/modules/users/user.service';
import { outbox } from './outbox';

export const app = createApp();
export const api = () => request(app);
export const PASSWORD = 'Milki@2026';

let seq = 0;
/** Creates an ACTIVE user directly in Mongo and returns it with a valid access token. */
export async function makeUser(role: Role, overrides: Record<string, unknown> = {}) {
  seq += 1;
  const nida = `1990010112345${String(seq).padStart(7, '0')}`;
  const user = await User.create({
    userId: newUserId(),
    role,
    fullName: `${role} User ${seq}`,
    phone: `+25571${String(1000000 + seq).slice(-7)}`,
    email: `${role.toLowerCase()}${seq}@milki.test`,
    passwordHash: await hashPassword(PASSWORD),
    status: 'ACTIVE',
    ...(role === 'CITIZEN' ? { nidaHash: piiHash(nida), nidaLast4: nida.slice(-4) } : {}),
    ...overrides,
  });
  const { accessToken } = issueTokens({ userId: user.userId, role });
  return { user, token: accessToken, nida };
}

/** The 6-digit code from the most recent SMS. */
export function lastOtp(): string {
  const msg = outbox.filter((m) => m.kind === 'sms').at(-1);
  const code = msg?.text.match(/\b(\d{6})\b/)?.[1];
  expect(code, 'an OTP SMS should have been sent').toBeTruthy();
  return code as string;
}

export async function reauth(token: string): Promise<string> {
  const res = await api().post('/api/v1/auth/reauth').set('Authorization', `Bearer ${token}`).send({ password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.data.reauthToken as string;
}

export const idemKey = () => `test-${randomUUID()}`;
