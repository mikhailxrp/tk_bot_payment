import { createHash } from 'node:crypto';

import { config } from '../config.js';

const ROBO_MERCHANT_URL = 'https://auth.robokassa.ru/Merchant/Index.aspx';

export function formatOutSum(amount: number | string): string {
  const num = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid amount: ${amount}`);
  }
  return num.toFixed(2);
}

/** Canonical Receipt JSON string — build once, then only encode for signature/URL. */
export function buildReceipt(amount: number | string, description: string): string {
  const sum = formatOutSum(amount);
  return `{"sno":${JSON.stringify(config.ROBO_SNO)},"items":[{"name":${JSON.stringify(description)},"quantity":1,"sum":${sum},"payment_method":"full_payment","payment_object":"service","tax":${JSON.stringify(config.ROBO_TAX)}}]}`;
}

export function buildSignature(
  outSum: string,
  invId: number | string,
  receiptJson: string,
): string {
  const encodedReceipt = encodeURIComponent(receiptJson);
  const signatureBase = [
    config.ROBO_LOGIN,
    outSum,
    String(invId),
    encodedReceipt,
    config.ROBO_PASS1,
  ].join(':');
  return createHash('md5').update(signatureBase).digest('hex');
}

export function buildPaymentUrl(
  amount: number | string,
  invId: number | string,
  description: string,
): string {
  const outSum = formatOutSum(amount);
  const receiptJson = buildReceipt(amount, description);
  const receiptForUrl = encodeURIComponent(encodeURIComponent(receiptJson));
  const signature = buildSignature(outSum, invId, receiptJson);
  const isTest = config.ROBO_IS_TEST ? '1' : '0';

  const params = [
    `MerchantLogin=${encodeURIComponent(config.ROBO_LOGIN)}`,
    `OutSum=${outSum}`,
    `InvId=${encodeURIComponent(String(invId))}`,
    `Description=${encodeURIComponent(description)}`,
    `Receipt=${receiptForUrl}`,
    `SignatureValue=${signature}`,
    `IsTest=${isTest}`,
  ];

  return `${ROBO_MERCHANT_URL}?${params.join('&')}`;
}

export function verifyResultSignature(
  outSum: string,
  invId: number | string,
  signature: string,
): boolean {
  const signatureBase = [outSum, String(invId), config.ROBO_PASS2].join(':');
  const expected = createHash('md5').update(signatureBase).digest('hex');
  return expected.toLowerCase() === signature.toLowerCase();
}
