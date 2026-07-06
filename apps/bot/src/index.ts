import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { API_CONSTANTS } from 'grammy';

import { commonBot, subscriptionBot } from './bot/bot.js';
import { config } from './config.js';
import { startScheduler } from './jobs/scheduler.js';
import { logger } from './logger.js';
import { registerRobokassaWebhook } from './payments/webhook.js';

logger.info(
  {
    groupId: config.GROUP_ID.toString(),
    commonGroupId: config.COMMON_GROUP_ID.toString(),
    adminId: config.ADMIN_ID.toString(),
  },
  'starting bot',
);

const fastify = Fastify({ logger: false });

await fastify.register(formbody);
registerRobokassaWebhook(fastify);

subscriptionBot.catch((err) => {
  logger.error({ err: err.error, bot: 'subscription' }, 'bot error');
});

commonBot.catch((err) => {
  logger.error({ err: err.error, bot: 'common' }, 'bot error');
});

startScheduler();

const allowedUpdates = [...API_CONSTANTS.DEFAULT_UPDATE_TYPES, 'chat_member'] as const;

await Promise.all([
  fastify.listen({ port: config.PORT, host: '0.0.0.0' }).then(() => {
    logger.info({ port: config.PORT }, 'fastify listening');
  }),
  subscriptionBot.start({
    allowed_updates: [...allowedUpdates],
    onStart: (botInfo) => {
      logger.info({ username: botInfo.username }, 'subscription bot started (long polling)');
    },
  }),
  commonBot.start({
    allowed_updates: [...allowedUpdates],
    onStart: (botInfo) => {
      logger.info({ username: botInfo.username }, 'common bot started (long polling)');
    },
  }),
]);
