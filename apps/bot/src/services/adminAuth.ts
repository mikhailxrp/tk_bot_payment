import { createHmac } from 'node:crypto';

import { config } from '../config.js';

const TOKEN_TTL_MS = 2 * 60 * 1000;

function sign(payload: string): string {
  return createHmac('sha256', config.AUTH_SECRET).update(payload).digest('hex');
}

/**
 * One-time admin panel login token: `${telegramId}.${exp}.${hmac}`, verified by the admin
 * panel's Auth.js credentials provider. Stateless (no persisted/revocable token store) — a
 * short TTL is the only replay protection, an accepted v1 trade-off (see phase-8.md).
 */
export function buildAdminLoginToken(telegramId: bigint, now: Date): string {
  const exp = now.getTime() + TOKEN_TTL_MS;
  const payload = `${telegramId.toString()}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function buildAdminLoginUrl(panelUrl: string, telegramId: bigint, now: Date): string {
  const token = buildAdminLoginToken(telegramId, now);
  return `${panelUrl}/login/telegram?token=${encodeURIComponent(token)}`;
}
