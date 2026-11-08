import { createServer } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { connectDatastores, disconnectDatastores } from './core/datastores';
import { startEventListener, stopEventListener } from './core/fabric/events';
import { closeGatewayPool, initGatewayPool } from './core/fabric/gateway';
import { serviceIdentity } from './core/fabric/wallet';
import { logger } from './core/logger';
import { startEmailWorker, stopEmailWorker } from './core/notify';
import { attachSocket, closeSocket, onSocketAttached } from './core/socket';
import { ensureBucket } from './core/storage';
import { registerLedgerListeners } from './modules/ledger/ledger.listeners';
import { startNotificationWorker, stopNotificationWorker } from './modules/notifications/notification.service';
import { attachSupportNamespace } from './modules/support/support.socket';

async function main(): Promise<void> {
  await connectDatastores();
  await ensureBucket().catch((err: Error) => logger.warn({ err: err.message }, 'MinIO not reachable; uploads will fail until it is'));
  startEmailWorker();
  startNotificationWorker();

  if (env.FABRIC_ENABLED) {
    initGatewayPool();
    try {
      await serviceIdentity('org1');
      registerLedgerListeners();
      startEventListener();
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'Fabric not reachable at startup — ledger endpoints will return 503 until it is');
    }
  }

  const server = createServer(createApp());
  onSocketAttached(attachSupportNamespace);
  attachSocket(server);
  server.listen(env.PORT, () => logger.info({ port: env.PORT }, `Milki API listening on http://localhost:${env.PORT}`));

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopEventListener();
    server.close();
    await closeSocket();
    await stopEmailWorker();
    await stopNotificationWorker();
    closeGatewayPool();
    await disconnectDatastores();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
