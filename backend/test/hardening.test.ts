import { describe, expect, it } from 'vitest';
import { api } from './helpers';

/** CLAUDE.md §13 phase 10: rate limits and security headers. */
describe('hardening', () => {
  it('sends security headers and hides the framework', async () => {
    const res = await api().get('/api/v1/kb/categories');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=/);
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('applies the baseline per-IP API limit (policy advertised in headers)', async () => {
    const res = await api().get('/api/v1/kb/categories');
    expect(res.headers['ratelimit-policy']).toMatch(/^"?\w*"?;?q=600|600/);
  });

  it('rejects oversized JSON bodies', async () => {
    const res = await api().post('/api/v1/auth/login').set('content-type', 'application/json').send(JSON.stringify({ identifier: 'x'.repeat(1_200_000), password: 'x' }));
    expect(res.status).toBe(413);
  });

  it('never leaks stack traces on errors', async () => {
    const res = await api().post('/api/v1/auth/login').set('content-type', 'application/json').send('{"broken json');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts:\d+/);
    expect(res.body.error).toBeDefined();
  });
});
