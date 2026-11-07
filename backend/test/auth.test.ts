import { describe, expect, it, vi } from 'vitest';
import { userIdentity } from '../src/core/fabric/wallet';
import { AuditLog } from '../src/modules/audit/audit.model';
import { User } from '../src/modules/users/user.model';
import { PASSWORD, api, lastOtp, makeUser } from './helpers';
import { outbox } from './outbox';

const body = (over: Record<string, unknown> = {}) => ({
  fullName: 'Asha Mwakyusa',
  phone: '0712 345 678',
  email: 'Asha@Example.com',
  nida: '19900101-12345-00001-01',
  password: 'shamba2026',
  ...over,
});

async function registerAndVerify() {
  const reg = await api().post('/api/v1/auth/register').send(body());
  expect(reg.status).toBe(201);
  const verify = await api().post('/api/v1/auth/otp/verify').send({ challengeId: reg.body.data.challenge.challengeId, code: lastOtp() });
  expect(verify.status).toBe(200);
  return verify.body.data as { accessToken: string; refreshToken: string; user: { userId: string } };
}

describe('POST /auth/register → /auth/otp/verify', () => {
  it('creates a pending citizen, texts an OTP, and activates + enrolls on verification', async () => {
    const reg = await api().post('/api/v1/auth/register').send(body());
    expect(reg.status).toBe(201);
    expect(reg.body.data.challenge).toMatchObject({ purpose: 'REGISTER', sentTo: '+255•••••678', expiresIn: 300 });
    expect(outbox.at(-1)).toMatchObject({ kind: 'sms', to: '+255712345678' });

    const stored = await User.findOne({ userId: reg.body.data.userId }).lean();
    expect(stored).toMatchObject({ role: 'CITIZEN', status: 'PENDING_VERIFICATION', phone: '+255712345678', email: 'asha@example.com', nidaLast4: '0101' });
    expect(stored?.nidaHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain('19900101123450000101'); // NIDA only sealed + hashed
    expect(stored?.passwordHash).not.toBe('shamba2026');

    const res = await api().post('/api/v1/auth/otp/verify').send({ challengeId: reg.body.data.challenge.challengeId, code: lastOtp() });
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ role: 'CITIZEN', status: 'ACTIVE', nidaMasked: '••••••••••••••••0101', ledgerIdentity: { enrolled: true, mspId: 'Org1MSP' } });
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.headers['set-cookie']?.[0]).toMatch(/^milki_rt=.*HttpOnly.*SameSite=Strict/);
    expect(userIdentity).toHaveBeenCalledWith(expect.objectContaining({ role: 'CITIZEN' }));
    expect(await AuditLog.countDocuments({ action: { $in: ['auth.register', 'auth.session.start'] } })).toBe(2);
  });

  it('still signs the user in if the CA is down (identity is created later)', async () => {
    vi.mocked(userIdentity).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const session = await registerAndVerify();
    const u = await User.findOne({ userId: session.user.userId }).lean();
    expect(u?.fabric?.enrolled).toBe(false);
    expect(u?.fabric?.lastError).toContain('ECONNREFUSED');
  });

  it('rejects duplicates with a readable message', async () => {
    await api().post('/api/v1/auth/register').send(body());
    const dupPhone = await api().post('/api/v1/auth/register').send(body({ email: 'x@y.com', nida: '19900101123450000999' }));
    expect(dupPhone.status).toBe(409);
    expect(dupPhone.body.error).toMatchObject({ code: 'ACCOUNT_EXISTS', details: { field: 'phone' } });
    const dupNida = await api().post('/api/v1/auth/register').send(body({ phone: '0712000999', email: 'z@y.com' }));
    expect(dupNida.body.error.message).toContain('NIDA number');
  });

  it.each([
    ['phone', { phone: '12345' }, 'Tanzanian mobile'],
    ['nida', { nida: '123' }, '20-digit NIDA'],
    ['password', { password: 'short' }, '8 characters'],
    ['password', { password: 'onlyletters' }, 'at least one number'],
    ['email', { email: 'nope' }, 'valid email'],
  ])('validates %s', async (_f, over, msg) => {
    const res = await api().post('/api/v1/auth/register').send(body(over));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain(msg);
  });

  it('rejects malformed JSON with the error envelope', async () => {
    const res = await api().post('/api/v1/auth/register').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'INVALID_JSON', message: 'The request body is not valid JSON.', details: null } });
  });
});

describe('OTP rules', () => {
  it('locks a challenge after 5 wrong codes and codes are single-use', async () => {
    const reg = await api().post('/api/v1/auth/register').send(body());
    const challengeId = reg.body.data.challenge.challengeId as string;
    const good = lastOtp();
    const wrong = good === '000000' ? '111111' : '000000';
    for (let i = 1; i <= 4; i++) {
      const r = await api().post('/api/v1/auth/otp/verify').send({ challengeId, code: wrong });
      expect(r.body.error).toMatchObject({ code: 'OTP_INVALID' });
      expect(r.body.error.message).toContain(`${5 - i} attempt(s) left`);
    }
    const locked = await api().post('/api/v1/auth/otp/verify').send({ challengeId, code: wrong });
    expect(locked.status).toBe(429);
    const after = await api().post('/api/v1/auth/otp/verify').send({ challengeId, code: good });
    expect(after.body.error.code).toBe('OTP_EXPIRED');
  });

  it('resend issues a new challenge and kills the old one', async () => {
    const reg = await api().post('/api/v1/auth/register').send(body());
    const old = reg.body.data.challenge.challengeId as string;
    const res = await api().post('/api/v1/auth/otp/resend').send({ challengeId: old });
    expect(res.status).toBe(200);
    expect(res.body.data.challengeId).not.toBe(old);
    const stale = await api().post('/api/v1/auth/otp/verify').send({ challengeId: old, code: lastOtp() });
    expect(stale.body.error.code).toBe('OTP_EXPIRED');
    const fresh = await api().post('/api/v1/auth/otp/verify').send({ challengeId: res.body.data.challengeId, code: lastOtp() });
    expect(fresh.status).toBe(200);
  });
});

describe('POST /auth/login', () => {
  it('password + OTP; accepts phone in local format or email', async () => {
    const { user } = await makeUser('REGISTRAR');
    for (const identifier of [user.email as string, `0${user.phone.slice(4)}`]) {
      const step1 = await api().post('/api/v1/auth/login').send({ identifier, password: PASSWORD });
      expect(step1.status).toBe(200);
      expect(step1.body.data.purpose).toBe('LOGIN');
      const step2 = await api().post('/api/v1/auth/otp/verify').send({ challengeId: step1.body.data.challengeId, code: lastOtp() });
      expect(step2.status).toBe(200);
      expect(step2.body.data.user.role).toBe('REGISTRAR');
    }
  });

  it('gives the same error for unknown users and wrong passwords, and audits failures', async () => {
    const { user } = await makeUser('CITIZEN');
    const a = await api().post('/api/v1/auth/login').send({ identifier: user.phone, password: 'wrong-pass-1' });
    const b = await api().post('/api/v1/auth/login').send({ identifier: '+255799999999', password: 'wrong-pass-1' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toEqual(b.body.error);
    expect(await AuditLog.countDocuments({ action: 'auth.login', outcome: 'FAILURE' })).toBe(2);
  });

  it('refuses deactivated accounts and sends pending ones back to verification', async () => {
    const { user: off } = await makeUser('CITIZEN', { status: 'DEACTIVATED' });
    const r1 = await api().post('/api/v1/auth/login').send({ identifier: off.phone, password: PASSWORD });
    expect(r1.status).toBe(403);
    expect(r1.body.error.code).toBe('ACCOUNT_DEACTIVATED');
    const { user: pending } = await makeUser('CITIZEN', { status: 'PENDING_VERIFICATION' });
    const r2 = await api().post('/api/v1/auth/login').send({ identifier: pending.phone, password: PASSWORD });
    expect(r2.body.data.purpose).toBe('REGISTER');
  });
});

describe('sessions', () => {
  it('GET /auth/me needs a valid bearer token', async () => {
    expect((await api().get('/api/v1/auth/me')).status).toBe(401);
    expect((await api().get('/api/v1/auth/me').set('Authorization', 'Bearer nope')).status).toBe(401);
    const { token, user } = await makeUser('LAND_OFFICER');
    const me = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.data).toMatchObject({ userId: user.userId, role: 'LAND_OFFICER' });
  });

  it('refresh rotates: each refresh token works once (body or cookie)', async () => {
    const s = await registerAndVerify();
    const r1 = await api().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(r1.status).toBe(200);
    const replay = await api().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('SESSION_REVOKED');
    const viaCookie = await api().post('/api/v1/auth/refresh').set('Cookie', `milki_rt=${r1.body.data.refreshToken}`);
    expect(viaCookie.status).toBe(200);
  });

  it('logout revokes the refresh token', async () => {
    const s = await registerAndVerify();
    await api().post('/api/v1/auth/logout').send({ refreshToken: s.refreshToken }).expect(200);
    const r = await api().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(r.status).toBe(401);
    expect((await api().post('/api/v1/auth/refresh').send({})).body.error.code).toBe('SESSION_EXPIRED');
  });

  it('refresh fails for a deactivated user', async () => {
    const s = await registerAndVerify();
    await User.updateOne({ userId: s.user.userId }, { status: 'DEACTIVATED' });
    expect((await api().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken })).status).toBe(401);
  });
});

describe('re-authentication (T3)', () => {
  it('by password or by REAUTH OTP', async () => {
    const { token } = await makeUser('REGISTRAR');
    const bad = await api().post('/api/v1/auth/reauth').set('Authorization', `Bearer ${token}`).send({ password: 'nope' });
    expect(bad.status).toBe(401);
    const byPw = await api().post('/api/v1/auth/reauth').set('Authorization', `Bearer ${token}`).send({ password: PASSWORD });
    expect(byPw.body.data).toMatchObject({ expiresIn: 300 });

    const ch = await api().post('/api/v1/auth/reauth/otp').set('Authorization', `Bearer ${token}`);
    expect(outbox.at(-1)?.text).toContain('confirmation code');
    const byOtp = await api()
      .post('/api/v1/auth/reauth')
      .set('Authorization', `Bearer ${token}`)
      .send({ challengeId: ch.body.data.challengeId, code: lastOtp() });
    expect(byOtp.status).toBe(200);
    expect(byOtp.body.data.reauthToken).toBeTruthy();
  });

  it("refuses another user's REAUTH code and login codes", async () => {
    const a = await makeUser('REGISTRAR');
    const b = await makeUser('REGISTRAR');
    const ch = await api().post('/api/v1/auth/reauth/otp').set('Authorization', `Bearer ${a.token}`);
    const res = await api().post('/api/v1/auth/reauth').set('Authorization', `Bearer ${b.token}`).send({ challengeId: ch.body.data.challengeId, code: lastOtp() });
    expect(res.status).toBe(401);

    const login = await api().post('/api/v1/auth/login').send({ identifier: a.user.phone, password: PASSWORD });
    const misuse = await api().post('/api/v1/auth/reauth').set('Authorization', `Bearer ${a.token}`).send({ challengeId: login.body.data.challengeId, code: lastOtp() });
    expect(misuse.body.error.code).toBe('OTP_INVALID');
  });
});
