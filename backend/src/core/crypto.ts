import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

/** AES-256-GCM envelope used for wallet private keys and stored NIDA numbers. */
export interface Sealed {
  iv: string;
  tag: string;
  ct: string;
}

const key = (): Buffer => Buffer.from(env.WALLET_ENCRYPTION_KEY, 'hex');

export function seal(plaintext: string, aad = 'milki'): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

/** Throws if the ciphertext, tag or AAD were tampered with. */
export function unseal(sealed: Sealed, aad = 'milki'): string {
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(sealed.iv, 'base64'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ct, 'base64')), decipher.final()]).toString('utf8');
}

/**
 * Salted hash for personal data (CLAUDE.md rule 4). The NIDA hash is what goes on-chain as
 * ownerNidaHash / buyerNidaHash, so it must be stable for a given salt.
 */
export function piiHash(value: string): string {
  return createHmac('sha256', env.PII_HASH_SALT).update(value).digest('hex');
}

export const sha256Hex = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
