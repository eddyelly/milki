import { readFileSync } from 'node:fs';
import path from 'node:path';
import { env } from '../../config/env';
import { ORG_MSP, type OrgKey } from '../roles';

export interface OrgConfig {
  key: OrgKey;
  mspId: string;
  peerEndpoint: string;
  peerHostAlias: string;
  peerTlsCert: Buffer;
  caUrl: string;
  caName: string;
  caTlsCert: string;
}

const orgsPath = (): string => path.resolve(process.cwd(), env.FABRIC_ORGS_PATH);

/** test-network layout. Org3 is created by addOrg3, which keeps its CA material under addOrg3/fabric-ca. */
function paths(key: OrgKey): { peerTls: string; caTls: string } {
  const n = key.slice(3);
  const base = orgsPath();
  return {
    peerTls: path.join(base, `peerOrganizations/org${n}.example.com/peers/peer0.org${n}.example.com/tls/ca.crt`),
    caTls: key === 'org3' ? path.join(base, '../addOrg3/fabric-ca/org3/ca-cert.pem') : path.join(base, `fabric-ca/org${n}/ca-cert.pem`),
  };
}

const cache = new Map<OrgKey, OrgConfig>();

export function orgConfig(key: OrgKey): OrgConfig {
  const hit = cache.get(key);
  if (hit) return hit;
  const p = paths(key);
  const byKey = {
    org1: { endpoint: env.ORG1_PEER_ENDPOINT, alias: env.ORG1_PEER_HOST_ALIAS, caUrl: env.ORG1_CA_URL, caName: env.ORG1_CA_NAME },
    org2: { endpoint: env.ORG2_PEER_ENDPOINT, alias: env.ORG2_PEER_HOST_ALIAS, caUrl: env.ORG2_CA_URL, caName: env.ORG2_CA_NAME },
    org3: { endpoint: env.ORG3_PEER_ENDPOINT, alias: env.ORG3_PEER_HOST_ALIAS, caUrl: env.ORG3_CA_URL, caName: env.ORG3_CA_NAME },
  }[key];
  const cfg: OrgConfig = {
    key,
    mspId: ORG_MSP[key],
    peerEndpoint: byKey.endpoint,
    peerHostAlias: byKey.alias,
    peerTlsCert: readFileSync(p.peerTls),
    caUrl: byKey.caUrl,
    caName: byKey.caName,
    caTlsCert: readFileSync(p.caTls, 'utf8'),
  };
  cache.set(key, cfg);
  return cfg;
}

export const ORG_KEYS: readonly OrgKey[] = ['org1', 'org2', 'org3'];
