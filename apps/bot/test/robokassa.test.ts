import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { config } from '../src/config.js';
import {
  buildPaymentUrl,
  buildReceipt,
  buildSignature,
  formatOutSum,
  verifyResultSignature,
} from '../src/payments/robokassa.js';

describe('formatOutSum', () => {
  it('formats number with two decimal places', () => {
    expect(formatOutSum(500)).toBe('500.00');
    expect(formatOutSum(500.1)).toBe('500.10');
  });

  it('formats string amount with two decimal places', () => {
    expect(formatOutSum('499.99')).toBe('499.99');
  });

  it('throws on invalid amount', () => {
    expect(() => formatOutSum('not-a-number')).toThrow('Invalid amount');
  });
});

describe('buildSignature', () => {
  it('hashes Login:OutSum:InvId:Receipt:Pass1 with Receipt encoded once', () => {
    const outSum = '500.00';
    const invId = 42;
    const description = 'Subscription';
    const receiptJson = buildReceipt(500, description);
    const encodedOnce = encodeURIComponent(receiptJson);

    const signature = buildSignature(outSum, invId, receiptJson);
    const expectedBase = [
      config.ROBO_LOGIN,
      outSum,
      String(invId),
      encodedOnce,
      config.ROBO_PASS1,
    ].join(':');
    const expected = createHash('md5').update(expectedBase).digest('hex');

    expect(signature).toBe(expected);
    expect(encodedOnce).not.toBe(encodeURIComponent(encodeURIComponent(receiptJson)));
  });
});

describe('buildPaymentUrl', () => {
  it('double-encodes Receipt in the URL query string', () => {
    const amount = 500;
    const invId = 42;
    const description = 'Subscription';
    const receiptJson = buildReceipt(amount, description);
    const url = buildPaymentUrl(amount, invId, description);

    const receiptParam = url.match(/Receipt=([^&]+)/)?.[1];
    const doubleEncoded = encodeURIComponent(encodeURIComponent(receiptJson));
    const singleEncoded = encodeURIComponent(receiptJson);

    expect(receiptParam).toBe(doubleEncoded);
    expect(receiptParam).not.toBe(singleEncoded);
  });

  it('includes required Robokassa params with IsTest from config', () => {
    const url = buildPaymentUrl(500, 42, 'Subscription');
    const params = new URL(url).searchParams;

    expect(url.startsWith('https://auth.robokassa.ru/Merchant/Index.aspx?')).toBe(true);
    expect(params.get('MerchantLogin')).toBe(config.ROBO_LOGIN);
    expect(params.get('OutSum')).toBe('500.00');
    expect(params.get('InvId')).toBe('42');
    expect(params.get('Description')).toBe('Subscription');
    expect(params.get('IsTest')).toBe('1');
    expect(params.get('SignatureValue')).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe('verifyResultSignature', () => {
  it('validates md5(OutSum:InvId:Pass2) case-insensitively', () => {
    const outSum = '500.00';
    const invId = 42;
    const expected = createHash('md5')
      .update(`${outSum}:${invId}:${config.ROBO_PASS2}`)
      .digest('hex');

    expect(verifyResultSignature(outSum, invId, expected.toUpperCase())).toBe(true);
    expect(verifyResultSignature(outSum, invId, expected.toLowerCase())).toBe(true);
  });

  it('rejects invalid signature', () => {
    expect(verifyResultSignature('500.00', 42, 'deadbeef')).toBe(false);
  });
});
