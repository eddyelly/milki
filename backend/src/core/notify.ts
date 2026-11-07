import { Queue, Worker } from 'bullmq';
import nodemailer from 'nodemailer';
import { env, isTest } from '../config/env';
import { newBullConnection } from './datastores';
import { logger } from './logger';

/**
 * Outbound messages go through the BullMQ `emails` queue. SMS is mocked (CLAUDE.md §16): in dev it is
 * delivered as an email to `<phone>@sms.milki.local`, so phone OTPs show up in Mailpit (http://localhost:8126).
 */
export interface OutboundMessage {
  kind: 'email' | 'sms';
  to: string;
  subject: string;
  text: string;
}

let queue: Queue<OutboundMessage> | null = null;
let worker: Worker<OutboundMessage> | null = null;

const transporter = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: false });

async function deliver(msg: OutboundMessage): Promise<void> {
  const to = msg.kind === 'sms' ? `${msg.to.replace(/[^0-9+]/g, '')}@sms.milki.local` : msg.to;
  const subject = msg.kind === 'sms' ? `SMS to ${msg.to}` : msg.subject;
  await transporter.sendMail({ from: env.SMTP_FROM, to, subject, text: msg.text });
}

function getQueue(): Queue<OutboundMessage> {
  queue ??= new Queue<OutboundMessage>('emails', {
    connection: newBullConnection(),
    defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 },
  });
  return queue;
}

async function enqueue(msg: OutboundMessage): Promise<void> {
  if (isTest) return deliver(msg);
  await getQueue().add(msg.kind, msg);
}

export const notify = {
  sms: (phone: string, text: string) => enqueue({ kind: 'sms', to: phone, subject: '', text }),
  email: (to: string, subject: string, text: string) => enqueue({ kind: 'email', to, subject, text }),
};

export function startEmailWorker(): void {
  worker = new Worker<OutboundMessage>('emails', async (job) => deliver(job.data), { connection: newBullConnection(), concurrency: 5 });
  worker.on('failed', (job, err) => logger.warn({ jobId: job?.id, err: err.message }, 'email delivery failed'));
}

export async function stopEmailWorker(): Promise<void> {
  await worker?.close();
  await queue?.close();
}
