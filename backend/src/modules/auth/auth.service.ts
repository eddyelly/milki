import bcrypt from 'bcrypt';
import { env } from '../../config/env';
import { consumeRefreshToken, issueReauthToken, issueTokens, REAUTH_TTL_SECONDS, revokeRefreshToken, type TokenPair } from '../../core/auth';
import { piiHash, randomToken, safeEqual, seal, sha256Hex } from '../../core/crypto';
import { AppError, conflict, forbidden, unauthorized } from '../../core/errors';
import { publicUser, type PublicUser, User, type UserDoc } from '../users/user.model';
import { ensureLedgerIdentity, findByIdentifier, findByUserId, newUserId } from '../users/user.service';
import type { EnrollDeviceInput, LoginInput, OtpInput, ReauthInput, RegisterInput } from './auth.schema';
import { ReauthDevice } from './reauth-device.model';
import { issueOtp, verifyOtp } from './otp.service';

export const BCRYPT_COST = env.NODE_ENV === 'test' ? 4 : 12;
/** Compared against when the user does not exist, so timing does not reveal registered numbers. */
const DUMMY_HASH = bcrypt.hashSync('milki-dummy-password-1', BCRYPT_COST);

export interface OtpChallenge {
  challengeId: string;
  sentTo: string;
  expiresIn: number;
  purpose: 'REGISTER' | 'LOGIN';
}

export interface Session extends TokenPair {
  user: PublicUser;
}

export const hashPassword = (pw: string): Promise<string> => bcrypt.hash(pw, BCRYPT_COST);

/** Citizen self-registration. The account stays PENDING_VERIFICATION until the phone OTP is confirmed. */
export async function register(input: RegisterInput): Promise<{ userId: string; challenge: OtpChallenge }> {
  const nidaHash = piiHash(input.nida);
  const clash = await User.findOne({
    $or: [{ phone: input.phone }, { nidaHash }, ...(input.email ? [{ email: input.email }] : [])],
  }).lean();
  if (clash) {
    const field = clash.phone === input.phone ? 'phone' : clash.nidaHash === nidaHash ? 'nida' : 'email';
    const label = { phone: 'phone number', nida: 'NIDA number', email: 'email address' }[field];
    throw conflict(`An account with this ${label} already exists. Try signing in instead.`, { field }, 'ACCOUNT_EXISTS');
  }
  const user = await User.create({
    userId: newUserId(),
    role: 'CITIZEN',
    fullName: input.fullName,
    phone: input.phone,
    email: input.email,
    passwordHash: await hashPassword(input.password),
    nidaHash,
    nidaSealed: seal(input.nida, 'milki-nida'),
    nidaLast4: input.nida.slice(-4),
    preferredLanguage: input.preferredLanguage,
    status: 'PENDING_VERIFICATION',
  });
  const otp = await issueOtp(user.userId, user.phone, 'REGISTER');
  return { userId: user.userId, challenge: { ...otp, purpose: 'REGISTER' } };
}

/** Step 1 of sign-in: password, then an OTP to the phone (step 2: verifyOtp). */
export async function login(input: LoginInput): Promise<OtpChallenge> {
  const user = await findByIdentifier(input.identifier);
  const okPassword = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !okPassword) throw unauthorized('Wrong phone number, email or password.', 'INVALID_CREDENTIALS');
  if (user.status === 'DEACTIVATED') throw forbidden('This account has been deactivated. Please contact support.', 'ACCOUNT_DEACTIVATED');
  const purpose = user.status === 'PENDING_VERIFICATION' ? 'REGISTER' : 'LOGIN';
  const otp = await issueOtp(user.userId, user.phone, purpose);
  return { ...otp, purpose };
}

async function startSession(user: UserDoc): Promise<Session> {
  user.lastLoginAt = new Date();
  await user.save();
  return { user: publicUser(user), ...issueTokens({ userId: user.userId, role: user.role }) };
}

/** Step 2: confirms a REGISTER or LOGIN code and opens a session. Registration also creates the ledger identity. */
export async function completeOtp(input: OtpInput): Promise<Session> {
  const { userId, purpose } = await verifyOtp(input.challengeId, input.code, ['REGISTER', 'LOGIN']);
  const user = await findByUserId(userId);
  if (!user) throw unauthorized('This account no longer exists.', 'INVALID_CREDENTIALS');
  if (user.status === 'DEACTIVATED') throw forbidden('This account has been deactivated. Please contact support.', 'ACCOUNT_DEACTIVATED');
  if (purpose === 'REGISTER' && user.status === 'PENDING_VERIFICATION') {
    user.status = 'ACTIVE';
    await user.save();
  }
  if (!user.fabric?.enrolled) await ensureLedgerIdentity(user);
  return startSession(user);
}

export async function refresh(refreshToken: string | undefined): Promise<Session> {
  if (!refreshToken) throw unauthorized('Your session has expired. Please sign in again.', 'SESSION_EXPIRED');
  const userId = await consumeRefreshToken(refreshToken);
  const user = await findByUserId(userId);
  if (!user || user.status !== 'ACTIVE') throw unauthorized('Your session has expired. Please sign in again.', 'SESSION_EXPIRED');
  return { user: publicUser(user), ...issueTokens({ userId: user.userId, role: user.role }) };
}

export async function logout(refreshToken: string | undefined): Promise<void> {
  if (refreshToken) await revokeRefreshToken(refreshToken);
}

export async function me(userId: string): Promise<PublicUser> {
  const user = await findByUserId(userId);
  if (!user) throw unauthorized();
  return publicUser(user);
}

export async function requestReauthOtp(userId: string): Promise<{ challengeId: string; sentTo: string; expiresIn: number }> {
  const user = await findByUserId(userId);
  if (!user) throw unauthorized();
  return issueOtp(user.userId, user.phone, 'REAUTH');
}

/** T3 confirmation (CLAUDE.md §8): returns a single-use token valid for 5 minutes. */
export async function reauthenticate(userId: string, input: ReauthInput): Promise<{ reauthToken: string; expiresIn: number }> {
  const user = await findByUserId(userId);
  if (!user || user.status !== 'ACTIVE') throw unauthorized();
  if ('password' in input) {
    if (!(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'That password is not correct.');
    }
  } else if ('deviceSecret' in input) {
    const device = await ReauthDevice.findOne({ userId: user.userId, deviceId: input.deviceId, revokedAt: null });
    if (!device || !safeEqual(device.secretHash, sha256Hex(input.deviceSecret))) {
      throw new AppError(401, 'DEVICE_NOT_TRUSTED', 'This phone is no longer set up for fingerprint confirmation. Use your password instead.');
    }
    device.lastUsedAt = new Date();
    await device.save();
  } else {
    const res = await verifyOtp(input.challengeId, input.code, 'REAUTH');
    if (res.userId !== user.userId) throw unauthorized('This code belongs to another account.', 'OTP_INVALID');
  }
  return { reauthToken: issueReauthToken(user.userId), expiresIn: REAUTH_TTL_SECONDS };
}

/** Creates (or replaces) this phone's biometric re-auth secret. Returned once; only its hash is stored. */
export async function enrollReauthDevice(userId: string, input: EnrollDeviceInput): Promise<{ deviceId: string; deviceSecret: string }> {
  const user = await findByUserId(userId);
  if (!user || user.status !== 'ACTIVE') throw unauthorized();
  if (!(await bcrypt.compare(input.password, user.passwordHash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'That password is not correct.');
  }
  const deviceSecret = randomToken(32);
  await ReauthDevice.updateOne(
    { userId, deviceId: input.deviceId },
    { userId, deviceId: input.deviceId, deviceName: input.deviceName, secretHash: sha256Hex(deviceSecret), revokedAt: null },
    { upsert: true },
  );
  return { deviceId: input.deviceId, deviceSecret };
}

export async function revokeReauthDevice(userId: string, deviceId: string): Promise<boolean> {
  const r = await ReauthDevice.updateOne({ userId, deviceId, revokedAt: null }, { revokedAt: new Date() });
  return r.modifiedCount > 0;
}
