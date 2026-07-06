import { PaymentStatus, ProductType, prisma } from '@tg-bot/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { bot } from '../bot/bot.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { notifyAdmins } from '../services/notify.js';
import {
  applyCommonAccess,
  applyPayment,
  grantAccessAfterPayment,
  unmuteUserAfterPayment,
  type GrantAccessAfterPaymentParams,
} from '../services/subscription.js';
import { verifyResultSignature } from './robokassa.js';

const PERIOD_DAYS_PATTERN = /^\d+$/;

const robokassaResultBodySchema = z.object({
  OutSum: z.string().trim().min(1),
  InvId: z.coerce.number().int().positive(),
  SignatureValue: z.string().trim().min(1),
});

function okResponse(invId: number): string {
  return `OK${invId}`;
}

type WebhookOkResult = {
  kind: 'ok';
  invId: number;
  freshlyProcessed: boolean;
  access?: GrantAccessAfterPaymentParams;
};

type WebhookResult = WebhookOkResult | { kind: 'not_processable' };

async function grantAccessBestEffort(result: WebhookOkResult): Promise<void> {
  if (!result.freshlyProcessed || !result.access) {
    return;
  }

  try {
    await grantAccessAfterPayment(result.access);
  } catch (err) {
    logger.error(
      {
        err,
        invId: result.invId,
        userId: result.access.userId.toString(),
      },
      'robokassa webhook: failed to grant access after payment',
    );

    try {
      await notifyAdmins(
        bot,
        `⚠️ Ошибка выдачи доступа после оплаты (InvId ${result.invId}). Проверьте вручную.`,
      );
    } catch (alertErr) {
      logger.error(
        { err: alertErr, invId: result.invId },
        'robokassa webhook: failed to notify admins about grant access error',
      );
    }
  }

  if (
    result.access.product === ProductType.SUBSCRIPTION &&
    result.access.wasMuted
  ) {
    try {
      const unmuted = await unmuteUserAfterPayment(result.access.userId);
      if (!unmuted) {
        logger.error(
          {
            invId: result.invId,
            userId: result.access.userId.toString(),
          },
          'robokassa webhook: failed to unmute user after payment',
        );

        await notifyAdmins(
          bot,
          `⚠️ Ошибка unmute после оплаты (InvId ${result.invId}). Проверьте вручную.`,
        );
      }
    } catch (alertErr) {
      logger.error(
        { err: alertErr, invId: result.invId },
        'robokassa webhook: failed to notify admins about unmute error',
      );
    }
  }
}

export function registerRobokassaWebhook(fastify: FastifyInstance): void {
  const resultPath = new URL(config.ROBOKASSA_RESULT_URL).pathname;
  const successPath = new URL(config.ROBOKASSA_SUCCESS_URL).pathname;
  const failPath = new URL(config.ROBOKASSA_FAIL_URL).pathname;

  fastify.get(successPath, async (_request, reply) => {
    return reply.type('text/plain').send('Оплата прошла успешно. Вернитесь в Telegram.');
  });

  fastify.get(failPath, async (_request, reply) => {
    return reply.type('text/plain').send('Оплата не прошла. Вернитесь в Telegram и попробуйте снова.');
  });

  fastify.post(resultPath, async (request, reply) => {
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

    let result: WebhookResult;

    try {
      result = await prisma.$transaction(async (tx) => {
        const updated = await tx.payment.updateMany({
          where: { id: InvId, status: PaymentStatus.PENDING },
          data: { status: PaymentStatus.PAID, paidAt: now },
        });

        if (updated.count === 0) {
          const existing = await tx.payment.findUnique({ where: { id: InvId } });
          if (existing?.status === PaymentStatus.PAID) {
            return { kind: 'ok' as const, invId: InvId, freshlyProcessed: false };
          }
          return { kind: 'not_processable' as const };
        }

        const payment = await tx.payment.findUniqueOrThrow({ where: { id: InvId } });
        const user = await tx.user.findUniqueOrThrow({
          where: { id: payment.userId },
          select: { username: true },
        });

        const accessBase = {
          userId: payment.userId,
          product: payment.product,
          amount: payment.amount,
          username: user.username,
        };

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

          return {
            kind: 'ok' as const,
            invId: InvId,
            freshlyProcessed: true,
            access: { ...accessBase, wasMuted: false },
          };
        }

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

        const { expiresAt, wasMuted } = await applyPayment(tx, payment, now, periodDays);

        logger.info(
          {
            paymentId: payment.id,
            userId: payment.userId.toString(),
            periodDays,
          },
          'robokassa webhook: payment processed',
        );

        return {
          kind: 'ok' as const,
          invId: InvId,
          freshlyProcessed: true,
          access: { ...accessBase, expiresAt, wasMuted },
        };
      });
    } catch (err) {
      logger.error({ err, invId: InvId }, 'robokassa webhook: transaction failed');
      return reply.code(500).type('text/plain').send('Internal Server Error');
    }

    if (result.kind === 'not_processable') {
      logger.warn({ invId: InvId }, 'robokassa webhook: payment not found or not pending');
      return reply.code(400).type('text/plain').send('Bad Request');
    }

    await grantAccessBestEffort(result);

    return reply.type('text/plain').send(okResponse(result.invId));
  });
}
