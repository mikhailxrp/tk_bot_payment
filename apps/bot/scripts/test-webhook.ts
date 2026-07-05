import { createHash } from 'node:crypto';

import { PaymentStatus, prisma } from '@tg-bot/db';

import { config } from '../src/config.js';
import { formatOutSum } from '../src/payments/robokassa.js';

const BAD_SIGNATURE_FLAG = '--bad-signature';

function buildResultSignature(outSum: string, invId: number): string {
  return createHash('md5')
    .update(`${outSum}:${invId}:${config.ROBO_PASS2}`)
    .digest('hex');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const invIdArg = args.find((arg) => arg !== BAD_SIGNATURE_FLAG);
  const useBadSignature = args.includes(BAD_SIGNATURE_FLAG);

  const payment = invIdArg
    ? await prisma.payment.findUniqueOrThrow({ where: { id: Number(invIdArg) } })
    : await prisma.payment.findFirstOrThrow({
        where: { status: PaymentStatus.PENDING },
        orderBy: { createdAt: 'desc' },
      });

  const outSum = formatOutSum(payment.amount.toString());
  const invId = payment.id;
  const signature = useBadSignature
    ? `${buildResultSignature(outSum, invId)}deadbeef`
    : buildResultSignature(outSum, invId);

  console.log('Sending:', { invId, outSum, status: payment.status, badSignature: useBadSignature });

  const res = await fetch(`http://localhost:${config.PORT}/robokassa/result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      OutSum: outSum,
      InvId: String(invId),
      SignatureValue: signature,
    }),
  });

  console.log('Response:', res.status, await res.text());
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
