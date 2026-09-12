import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { verifyAdminLoginToken } from '../lib/verifyAdminLoginToken.js';

const SECRET = 'test-secret';
const TEST_TELEGRAM_ID = BigInt(123456789);

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function buildToken(telegramId: bigint, exp: number, secret: string): string {
  const payload = `${telegramId.toString()}.${exp}`;
  return `${payload}.${sign(payload, secret)}`;
}

describe('verifyAdminLoginToken', () => {
  const now = new Date('2026-01-15T12:00:00.000Z');

  it('accepts a valid, unexpired token and returns the telegramId', () => {
    const exp = now.getTime() + 60_000;
    const token = buildToken(TEST_TELEGRAM_ID, exp, SECRET);

    const result = verifyAdminLoginToken(token, SECRET, now);

    expect(result).toEqual({ telegramId: TEST_TELEGRAM_ID });
  });

  it('rejects an expired token', () => {
    const exp = now.getTime() - 1;
    const token = buildToken(TEST_TELEGRAM_ID, exp, SECRET);

    expect(verifyAdminLoginToken(token, SECRET, now)).toBeNull();
  });

  it('accepts a token expiring exactly now (inclusive boundary)', () => {
    const exp = now.getTime();
    const token = buildToken(TEST_TELEGRAM_ID, exp, SECRET);

    expect(verifyAdminLoginToken(token, SECRET, now)).toEqual({ telegramId: TEST_TELEGRAM_ID });
  });

  it('rejects a token signed with a different secret', () => {
    const exp = now.getTime() + 60_000;
    const token = buildToken(TEST_TELEGRAM_ID, exp, 'wrong-secret');

    expect(verifyAdminLoginToken(token, SECRET, now)).toBeNull();
  });

  it('rejects a tampered telegramId (signature no longer matches)', () => {
    const exp = now.getTime() + 60_000;
    const token = buildToken(TEST_TELEGRAM_ID, exp, SECRET);
    const [, expPart, sigPart] = token.split('.');
    const tampered = `${BigInt(999).toString()}.${expPart}.${sigPart}`;

    expect(verifyAdminLoginToken(tampered, SECRET, now)).toBeNull();
  });

  it('rejects a malformed token (wrong number of parts)', () => {
    expect(verifyAdminLoginToken('not-a-token', SECRET, now)).toBeNull();
    expect(verifyAdminLoginToken('a.b.c.d', SECRET, now)).toBeNull();
  });

  it('rejects a token with a non-numeric exp', () => {
    const token = `${TEST_TELEGRAM_ID.toString()}.not-a-number.${sign(`${TEST_TELEGRAM_ID.toString()}.not-a-number`, SECRET)}`;

    expect(verifyAdminLoginToken(token, SECRET, now)).toBeNull();
  });
});
