import type { Context } from 'fabric-contract-api';
import { forbidden } from './errors';
import { type ActorRef, type Role, ROLE_MSP, ROLES } from './models';

const ROLE_LABEL: Readonly<Record<Role, string>> = {
  CITIZEN: 'a landowner',
  LAND_OFFICER: 'a land officer',
  REGISTRAR: 'a registrar',
  BANK_OFFICER: 'a bank officer',
  SUPPORT_AGENT: 'a support agent',
  SYSTEM_ADMIN: 'a system administrator',
};

/** Extracts the CN (= enrollment ID) from ClientIdentity.getID(): "x509::/OU=client/CN=alice::/C=US/.../CN=ca.org1". */
export function enrollmentIdFromClientId(clientId: string): string {
  const subject = /^x509::(.*?)::/.exec(clientId)?.[1] ?? '';
  const cn = /(?:^|\/)CN=([^/]+)/.exec(subject)?.[1];
  if (!cn) throw forbidden('Your identity could not be read. Please sign in again.');
  return cn;
}

/**
 * Resolves the caller. The `role` comes from the CA-signed certificate attribute and must belong to
 * the caller's MSP, e.g. a "REGISTRAR" certificate issued by the bank CA (Org3) is rejected.
 * Identities without a role (org admins, peer CLI) get role null and can only read.
 */
export function getActor(ctx: Context): ActorRef {
  const mspId = ctx.clientIdentity.getMSPID();
  const id = enrollmentIdFromClientId(ctx.clientIdentity.getID());
  const raw = ctx.clientIdentity.getAttributeValue('role');
  if (raw === null || raw === undefined || raw === '') return { id, mspId, role: null };
  if (!(ROLES as readonly string[]).includes(raw)) {
    throw forbidden('Your account has an unknown role. Please contact support.');
  }
  const role = raw as Role;
  if (ROLE_MSP[role] !== mspId) {
    throw forbidden(`Your ${role} credential was not issued by the right organisation.`, { role, mspId });
  }
  return { id, mspId, role };
}

/** Throws unless the actor holds one of `roles`; `action` completes "Only … can <action>." */
export function requireRole(actor: ActorRef, roles: readonly Role[], action: string): Role {
  if (actor.role === null || !roles.includes(actor.role)) {
    const who = roles.map((r) => ROLE_LABEL[r]).join(' or ');
    throw forbidden(`Only ${who} can ${action}.`);
  }
  return actor.role;
}

export const isRole = (actor: ActorRef, ...roles: Role[]): boolean => actor.role !== null && roles.includes(actor.role);

/**
 * Bank officers carry a `bank` certificate attribute (e.g. CRDB). All banks share Org3MSP, so this code is
 * what stops one bank from changing or releasing another bank's encumbrance.
 */
export function getBankCode(ctx: Context): string {
  const code = ctx.clientIdentity.getAttributeValue('bank');
  if (!code || !/^[A-Z0-9]{2,10}$/.test(code)) {
    throw forbidden('Your bank officer account is not linked to a bank. Please contact the system administrator.');
  }
  return code;
}
