import { createPrivateKey } from 'node:crypto';
import * as grpc from '@grpc/grpc-js';
import { connect, type Contract, type Gateway, hash, type Network, signers } from '@hyperledger/fabric-gateway';
import { env } from '../../config/env';
import type { OrgKey } from '../roles';
import type { LedgerIdentity } from './wallet';
import { ORG_KEYS, orgConfig } from './orgs';

/** One gRPC connection per org, created at startup and shared by every gateway (CLAUDE.md §12). */
const clients = new Map<OrgKey, grpc.Client>();

export function grpcClient(org: OrgKey): grpc.Client {
  let client = clients.get(org);
  if (!client) {
    const cfg = orgConfig(org);
    client = new grpc.Client(cfg.peerEndpoint, grpc.credentials.createSsl(cfg.peerTlsCert), {
      'grpc.ssl_target_name_override': cfg.peerHostAlias,
    });
    clients.set(org, client);
  }
  return client;
}

export function initGatewayPool(): void {
  for (const org of ORG_KEYS) grpcClient(org);
}

export function closeGatewayPool(): void {
  for (const c of clients.values()) c.close();
  clients.clear();
}

export interface ConnectedContract {
  gateway: Gateway;
  network: Network;
  contract: Contract;
}

/**
 * A lightweight Gateway bound to one identity over the shared org connection. Callers must close it
 * (after any commit status they still need has arrived).
 */
export function openGateway(identity: LedgerIdentity): ConnectedContract {
  const gateway = connect({
    client: grpcClient(identity.org),
    identity: { mspId: identity.mspId, credentials: Buffer.from(identity.certificate) },
    signer: signers.newPrivateKeySigner(createPrivateKey(identity.privateKeyPem)),
    hash: hash.sha256,
    evaluateOptions: () => ({ deadline: Date.now() + 10_000 }),
    endorseOptions: () => ({ deadline: Date.now() + 30_000 }),
    submitOptions: () => ({ deadline: Date.now() + 10_000 }),
    commitStatusOptions: () => ({ deadline: Date.now() + 60_000 }),
  });
  const network = gateway.getNetwork(env.FABRIC_CHANNEL);
  return { gateway, network, contract: network.getContract(env.FABRIC_CHAINCODE) };
}
