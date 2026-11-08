import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('true')
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  PORT: z.coerce.number().int().default(4100),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  MONGO_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),

  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().int().default(9100),
  MINIO_USE_SSL: bool.default(false),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().default('milki-documents'),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1126),
  SMTP_FROM: z.string().default('Milki <no-reply@milki.go.tz>'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters.'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters.'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  WALLET_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 32 bytes as 64 hex characters'),
  PII_HASH_SALT: z.string().min(8),

  FABRIC_ENABLED: bool,
  FABRIC_CHANNEL: z.string().default('land-channel'),
  FABRIC_CHAINCODE: z.string().default('land-registry'),
  FABRIC_ORGS_PATH: z.string().default('../network/fabric-samples/test-network/organizations'),
  FABRIC_CA_ADMIN_ID: z.string().default('admin'),
  FABRIC_CA_ADMIN_SECRET: z.string().default('adminpw'),
  ORG1_PEER_ENDPOINT: z.string().default('localhost:7051'),
  ORG1_PEER_HOST_ALIAS: z.string().default('peer0.org1.example.com'),
  ORG1_CA_URL: z.string().default('https://localhost:7054'),
  ORG1_CA_NAME: z.string().default('ca-org1'),
  ORG2_PEER_ENDPOINT: z.string().default('localhost:9051'),
  ORG2_PEER_HOST_ALIAS: z.string().default('peer0.org2.example.com'),
  ORG2_CA_URL: z.string().default('https://localhost:8054'),
  ORG2_CA_NAME: z.string().default('ca-org2'),
  ORG3_PEER_ENDPOINT: z.string().default('localhost:11051'),
  ORG3_PEER_HOST_ALIAS: z.string().default('peer0.org3.example.com'),
  ORG3_CA_URL: z.string().default('https://localhost:11054'),
  ORG3_CA_NAME: z.string().default('ca-org3'),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3100')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  FCM_SERVICE_ACCOUNT_PATH: z.string().default('./secrets/firebase.json'),
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(20),
  /** Every /api/v1 route except /partner (which has per-client limits): requests per minute per IP. */
  API_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(600),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}

export const env: Env = load();
export const isTest = env.NODE_ENV === 'test';
export const isProd = env.NODE_ENV === 'production';
