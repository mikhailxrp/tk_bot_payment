import { createHmac, timingSafeEqual } from 'node:crypto';

export type VerifiedAdminLoginToken = { telegramId: bigint };

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verifies a one-time admin login token built by the bot (`buildAdminLoginToken` in
 * apps/bot/src/services/adminAuth.ts) — same stateless HMAC protocol, independently
 * implemented on this side. Does not check the DB for a live `Admin` row; that happens in
 * the credentials provider's `authorize()` after this returns a telegramId.
 */
export function verifyAdminLoginToken(
  token: string,
  secret: string,
  now: Date,
): VerifiedAdminLoginToken | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [telegramIdPart, expPart, sigPart] = parts as [string, string, string];

  const exp = Number(expPart);
  if (!Number.isInteger(exp) || exp <= 0) {
    return null;
  }
  if (exp < now.getTime()) {
    return null;
  }

  const expectedSig = sign(`${telegramIdPart}.${expPart}`, secret);
  if (!safeEqual(sigPart, expectedSig)) {
    return null;
  }

  let telegramId: bigint;
  try {
    telegramId = BigInt(telegramIdPart);
  } catch {
    return null;
  }

  return { telegramId };
}
