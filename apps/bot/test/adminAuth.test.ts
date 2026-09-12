import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { config } from '../src/config.js';
import { buildAdminLoginToken, buildAdminLoginUrl } from '../src/services/adminAuth.js';

const TEST_TELEGRAM_ID = BigInt(123456789);

function expectedSignature(payload: string): string {
  return createHmac('sha256', config.AUTH_SECRET).update(payload).digest('hex');
}

describe('buildAdminLoginToken', () => {
  it('returns telegramId.exp.hmac with exp = now + 2 minutes', () => {
    const now = new Date('2026-01-15T12:00:00.000Z');

    const token = buildAdminLoginToken(TEST_TELEGRAM_ID, now);

    const [telegramIdPart, expPart, sigPart] = token.split('.');
    expect(telegramIdPart).toBe(TEST_TELEGRAM_ID.toString());
    expect(Number(expPart)).toBe(now.getTime() + 2 * 60 * 1000);
    expect(sigPart).toBe(expectedSignature(`${telegramIdPart}.${expPart}`));
  });

  it('produces a different signature for a different telegramId', () => {
    const now = new Date('2026-01-15T12:00:00.000Z');

    const tokenA = buildAdminLoginToken(BigInt(1), now);
    const tokenB = buildAdminLoginToken(BigInt(2), now);

    expect(tokenA).not.toBe(tokenB);
  });
});

describe('buildAdminLoginUrl', () => {
  it('appends an url-encoded token as ?token= on /login/telegram', () => {
    const now = new Date('2026-01-15T12:00:00.000Z');

    const url = buildAdminLoginUrl('https://panel.example.com', TEST_TELEGRAM_ID, now);
    const token = buildAdminLoginToken(TEST_TELEGRAM_ID, now);

    expect(url).toBe(
      `https://panel.example.com/login/telegram?token=${encodeURIComponent(token)}`,
    );
  });
});
