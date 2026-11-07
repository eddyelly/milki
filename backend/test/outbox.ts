/** Every SMS/email the code tried to send during a test, newest last. */
export const outbox: { kind: 'sms' | 'email'; to: string; text: string }[] = [];

/** In-memory stand-in for the MinIO bucket. */
export const objects = new Map<string, Buffer>();
