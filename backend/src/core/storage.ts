import { Client } from 'minio';
import { env } from '../config/env';
import { logger } from './logger';

/** MinIO client. Files never go on-chain (rule 5) — only their SHA-256. */
export const minio = new Client({
  endPoint: env.MINIO_ENDPOINT,
  port: env.MINIO_PORT,
  useSSL: env.MINIO_USE_SSL,
  accessKey: env.MINIO_ACCESS_KEY,
  secretKey: env.MINIO_SECRET_KEY,
});

/** Creates the private documents bucket on startup if missing (CLAUDE.md §5, Phase 1 decision). */
export async function ensureBucket(): Promise<void> {
  if (!(await minio.bucketExists(env.MINIO_BUCKET))) {
    await minio.makeBucket(env.MINIO_BUCKET);
    logger.info({ bucket: env.MINIO_BUCKET }, 'created MinIO bucket');
  }
}
