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

export async function putObject(key: string, data: Buffer, mimeType: string, meta: Record<string, string> = {}): Promise<void> {
  await minio.putObject(env.MINIO_BUCKET, key, data, data.length, { 'Content-Type': mimeType, ...meta });
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const stream = await minio.getObject(env.MINIO_BUCKET, key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export async function removeObject(key: string): Promise<void> {
  await minio.removeObject(env.MINIO_BUCKET, key);
}
