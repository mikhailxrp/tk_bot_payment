import { PaymentStatus, ProductType, prisma } from '@tg-bot/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { logger } from '../logger.js';
import { verifyResultSignature } from './robokassa.js';
import { applyCommonAccess, applyPayment } from '../services/subscription.js';

const PERIOD_DAYS_PATTERN = /^\d+$/;

const robokassaResultBodySchema = z.object({
  OutSum: z.string().trim().min(1),
  InvId: z.coerce.number().int().positive(),
  SignatureValue: z.string().trim().min(1),
});

function okResponse(invId: number): string {
  return `OK${invId}`;
}

export function registerRobokassaWebhook(fastify: FastifyInstance): void {
  fastify.post('/robokassa/result', async (request, reply) => {
    const parsedBody = robokassaResultBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).type('text/plain').send('Bad Request');
    }

    const { OutSum, InvId, SignatureValue } = parsedBody.data;

    if (!verifyResultSignature(OutSum, InvId, SignatureValue)) {
      logger.warn({ invId: InvId, outSum: OutSum }, 'robokassa webhook: invalid signature');
      return reply.code(400).type('text/plain').send('Bad Request');
    }

    const now = new Date();

    let result: { kind: 'ok'; invId: number } | { kind: 'not_processable' };

    try {
      result = await prisma.$transaction(async (tx) => {
        const updated = await tx.payment.updateMany({
          where: { id: InvId, status: PaymentStatus.PENDING },
          data: { status: PaymentStatus.PAID, paidAt: now },
        });

        if (updated.count === 0) {
          const existing = await tx.payment.findUnique({ where: { id: InvId } });
          if (existing?.status === PaymentStatus.PAID) {
            return { kind: 'ok' as const, invId: InvId };
          }
          return { kind: 'not_processable' as const };
        }

        const payment = await tx.payment.findUniqueOrThrow({ where: { id: InvId } });

        if (payment.product === ProductType.LIFETIME) {
          await applyCommonAccess(tx, payment, now);

          logger.info(
            {
              paymentId: payment.id,
              userId: payment.userId.toString(),
              product: payment.product,
            },
            'robokassa webhook: payment processed',
          );
        } else {
          const periodDaysSetting = await tx.setting.findUnique({
            where: { key: 'period_days' },
          });
          const periodDaysRaw = periodDaysSetting?.value;
          if (
            !periodDaysRaw ||
            !PERIOD_DAYS_PATTERN.test(periodDaysRaw) ||
            Number(periodDaysRaw) <= 0
          ) {
            throw new Error('Invalid period_days setting');
          }
          const periodDays = Number(periodDaysRaw);

          await applyPayment(tx, payment, now, periodDays);

          logger.info(
            {
              paymentId: payment.id,
              userId: payment.userId.toString(),
              periodDays,
            },
            'robokassa webhook: payment processed',
          );
        }

        return { kind: 'ok' as const, invId: InvId };
      });
    } catch (err) {
      logger.error({ err, invId: InvId }, 'robokassa webhook: transaction failed');
      return reply.code(500).type('text/plain').send('Internal Server Error');
    }

    if (result.kind === 'not_processable') {
      logger.warn({ invId: InvId }, 'robokassa webhook: payment not found or not pending');
      return reply.code(400).type('text/plain').send('Bad Request');
    }

    return reply.type('text/plain').send(okResponse(result.invId));
  });
}
