import { Types } from 'mongoose';
import type { AuthUser } from '../../core/auth';
import { userIdentity, type WalletUser } from '../../core/fabric/wallet';
import { logger } from '../../core/logger';
import { ROLE_ORG, ORG_MSP } from '../../core/roles';
import { User, type UserDoc } from './user.model';

export const newUserId = (): string => `usr_${new Types.ObjectId().toHexString()}`;

export async function findByIdentifier(identifier: string): Promise<UserDoc | null> {
  const id = identifier.trim();
  if (id.includes('@')) return User.findOne({ email: id.toLowerCase(), deletedAt: null });
  const digits = id.replace(/[\s()-]/g, '');
  const phone = digits.startsWith('0') ? `+255${digits.slice(1)}` : digits.startsWith('255') ? `+${digits}` : digits;
  return User.findOne({ phone, deletedAt: null });
}

export const findByUserId = (userId: string): Promise<UserDoc | null> => User.findOne({ userId, deletedAt: null });

/**
 * Makes sure the user has a Fabric identity (CA registration + sealed key in the wallet). Never throws:
 * if the CA is down, sign-in still works and the identity is created on the first ledger write.
 */
export async function ensureLedgerIdentity(user: UserDoc): Promise<boolean> {
  try {
    await userIdentity({ userId: user.userId, role: user.role, bankCode: user.bankCode });
    if (!user.fabric?.enrolled) {
      user.set('fabric', { enrolled: true, mspId: ORG_MSP[ROLE_ORG[user.role]], enrolledAt: new Date(), lastError: undefined });
      await user.save();
    }
    return true;
  } catch (err) {
    logger.warn({ userId: user.userId, err: (err as Error).message }, 'ledger enrollment deferred');
    user.set('fabric.lastError', (err as Error).message.slice(0, 200));
    await user.save().catch(() => undefined);
    return false;
  }
}

/** The wallet needs the bank code for bank officers; everyone else submits with userId + role. */
export async function toWalletUser(user: AuthUser): Promise<WalletUser> {
  if (user.role !== 'BANK_OFFICER') return user;
  const doc = await User.findOne({ userId: user.userId }, { bankCode: 1 }).lean();
  return { ...user, bankCode: doc?.bankCode };
}

/** "Juma Hassan" → "Juma H." — enough for a seller to confirm the right buyer without exposing full details. */
export const displayName = (fullName: string): string => {
  const [first, ...rest] = fullName.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0]}.` : (first ?? '');
};
