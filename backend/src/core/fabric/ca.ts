import FabricCAServices from 'fabric-ca-client';
import { User } from 'fabric-common';
import { env } from '../../config/env';
import { randomToken } from '../crypto';
import { logger } from '../logger';
import type { OrgKey, Role } from '../roles';
import { orgConfig } from './orgs';

/** A freshly enrolled X.509 identity. The private key must be sealed before it is stored. */
export interface EnrolledIdentity {
  mspId: string;
  certificate: string;
  privateKeyPem: string;
}

export interface IdentityAttributes {
  /** Omit for read-only service identities. */
  role?: Role;
  /** Required for BANK_OFFICER. */
  bank?: string;
}

const services = new Map<OrgKey, FabricCAServices>();
const registrars = new Map<OrgKey, Promise<User>>();

function ca(org: OrgKey): FabricCAServices {
  let svc = services.get(org);
  if (!svc) {
    const cfg = orgConfig(org);
    svc = new FabricCAServices(cfg.caUrl, { trustedRoots: [cfg.caTlsCert], verify: true }, cfg.caName);
    services.set(org, svc);
  }
  return svc;
}

/** The CA bootstrap admin of each org, enrolled once per process and kept in memory only. */
function registrar(org: OrgKey): Promise<User> {
  let p = registrars.get(org);
  if (!p) {
    p = (async () => {
      const cfg = orgConfig(org);
      const res = await ca(org).enroll({ enrollmentID: env.FABRIC_CA_ADMIN_ID, enrollmentSecret: env.FABRIC_CA_ADMIN_SECRET });
      return User.createUser(env.FABRIC_CA_ADMIN_ID, '', cfg.mspId, res.certificate, res.key.toBytes());
    })();
    p.catch(() => registrars.delete(org)); // allow a retry after a CA outage
    registrars.set(org, p);
  }
  return p;
}

const isAlreadyRegistered = (err: unknown): boolean => /already registered|is already registered/i.test(String((err as Error)?.message ?? err));

/**
 * Registers `enrollmentId` with the org's CA (with role / bank attributes in the certificate) and enrolls it.
 * If the identity already exists (e.g. its wallet entry was lost), its secret is reset and it is re-enrolled.
 */
export async function registerAndEnroll(org: OrgKey, enrollmentId: string, attrs: IdentityAttributes): Promise<EnrolledIdentity> {
  const admin = await registrar(org);
  const secret = randomToken(18);
  const kv = [
    ...(attrs.role ? [{ name: 'role', value: attrs.role, ecert: true }] : []),
    ...(attrs.bank ? [{ name: 'bank', value: attrs.bank, ecert: true }] : []),
  ];
  try {
    await ca(org).register({ enrollmentID: enrollmentId, enrollmentSecret: secret, role: 'client', affiliation: '', maxEnrollments: -1, attrs: kv }, admin);
  } catch (err) {
    if (!isAlreadyRegistered(err)) throw err;
    logger.info({ enrollmentId, org }, 'identity already registered; resetting secret and re-enrolling');
    await ca(org)
      .newIdentityService()
      .update(enrollmentId, { enrollmentID: enrollmentId, affiliation: '', enrollmentSecret: secret, attrs: kv }, admin);
  }
  const res = await ca(org).enroll({
    enrollmentID: enrollmentId,
    enrollmentSecret: secret,
    attr_reqs: kv.map((a) => ({ name: a.name, optional: false })),
  });
  return { mspId: orgConfig(org).mspId, certificate: res.certificate, privateKeyPem: res.key.toBytes() };
}
