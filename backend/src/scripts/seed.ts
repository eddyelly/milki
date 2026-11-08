/**
 * DEV ONLY (CLAUDE.md §15): one account per role, password `Milki@2026`. Sign-in OTPs arrive in Mailpit
 * (http://localhost:8126). Idempotent, re-running updates the same accounts. Phase 10 extends this with
 * demo parcels, transfers and tickets.
 *
 *   npm run seed
 */
import { env } from '../config/env';
import { piiHash, seal } from '../core/crypto';
import { connectDatastores, disconnectDatastores } from '../core/datastores';
import { closeGatewayPool, initGatewayPool } from '../core/fabric/gateway';
import { logger } from '../core/logger';
import type { Role } from '../core/roles';
import { hashPassword } from '../modules/auth/auth.service';
import { User } from '../modules/users/user.model';
import { ensureLedgerIdentity, newUserId } from '../modules/users/user.service';
import { seedSupport } from './seed-support';

if (env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed demo accounts in production.');
}

interface SeedUser {
  role: Role;
  fullName: string;
  phone: string;
  email: string;
  nida?: string;
  bankCode?: string;
  bankName?: string;
}

export const DEMO_PASSWORD = 'Milki@2026';

export const DEMO_USERS: SeedUser[] = [
  { role: 'CITIZEN', fullName: 'Asha Mwakyusa', phone: '+255712000001', email: 'citizen@milki.dev', nida: '19900101123450000101' },
  { role: 'CITIZEN', fullName: 'Juma Hassan', phone: '+255712000002', email: 'buyer@milki.dev', nida: '19920202123450000202' },
  { role: 'LAND_OFFICER', fullName: 'Neema Kileo', phone: '+255713000001', email: 'officer@milki.dev' },
  { role: 'REGISTRAR', fullName: 'Baraka Mushi', phone: '+255714000001', email: 'registrar@milki.dev' },
  { role: 'BANK_OFFICER', fullName: 'Grace Lyimo', phone: '+255715000001', email: 'bank@milki.dev', bankCode: 'CRDB', bankName: 'CRDB Bank' },
  { role: 'SUPPORT_AGENT', fullName: 'Halima Said', phone: '+255716000001', email: 'support@milki.dev' },
  { role: 'SYSTEM_ADMIN', fullName: 'System Administrator', phone: '+255717000001', email: 'admin@milki.dev' },
];

async function main(): Promise<void> {
  await connectDatastores();
  if (env.FABRIC_ENABLED) initGatewayPool();
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  for (const s of DEMO_USERS) {
    const existing = await User.findOne({ phone: s.phone });
    const user =
      existing ??
      new User({ userId: newUserId(), phone: s.phone });
    user.set({
      role: s.role,
      fullName: s.fullName,
      email: s.email,
      passwordHash,
      status: 'ACTIVE',
      deletedAt: null,
      ...(s.nida ? { nidaHash: piiHash(s.nida), nidaSealed: seal(s.nida, 'milki-nida'), nidaLast4: s.nida.slice(-4) } : {}),
      ...(s.bankCode ? { bankCode: s.bankCode, bankName: s.bankName } : {}),
    });
    await user.save();
    const enrolled = env.FABRIC_ENABLED ? await ensureLedgerIdentity(user) : false;
    logger.info({ role: s.role, email: s.email, userId: user.userId, ledgerIdentity: enrolled }, 'seeded user');
  }

  const idOf = async (email: string) => (await User.findOne({ email }, { userId: 1 }).lean())!.userId;
  const support = await seedSupport({ citizen: await idOf('citizen@milki.dev'), buyer: await idOf('buyer@milki.dev'), agent: await idOf('support@milki.dev') });
  logger.info(support, 'seeded help centre and support demo data');

  closeGatewayPool();
  await disconnectDatastores();
  // eslint-disable-next-line no-console
  console.log(`\nDemo accounts ready. Password for all: ${DEMO_PASSWORD}. OTPs: http://localhost:8126\n`);
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'seed failed');
  process.exit(1);
});
