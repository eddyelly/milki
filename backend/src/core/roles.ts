/** Roles (CLAUDE.md §2). Same strings as the Fabric CA `role` attribute and the JWT `role` claim. */
export const ROLES = ['CITIZEN', 'LAND_OFFICER', 'REGISTRAR', 'BANK_OFFICER', 'SUPPORT_AGENT', 'SYSTEM_ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES: readonly Role[] = ['LAND_OFFICER', 'REGISTRAR', 'BANK_OFFICER', 'SUPPORT_AGENT', 'SYSTEM_ADMIN'];

export type OrgKey = 'org1' | 'org2' | 'org3';

/** Which Fabric org enrolls (and therefore submits for) each role. */
export const ROLE_ORG: Readonly<Record<Role, OrgKey>> = {
  CITIZEN: 'org1',
  REGISTRAR: 'org1',
  SUPPORT_AGENT: 'org1',
  SYSTEM_ADMIN: 'org1',
  LAND_OFFICER: 'org2',
  BANK_OFFICER: 'org3',
};

export const ORG_MSP: Readonly<Record<OrgKey, string>> = { org1: 'Org1MSP', org2: 'Org2MSP', org3: 'Org3MSP' };
