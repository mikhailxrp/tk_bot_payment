import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { API_CONSTANTS } from 'grammy';

import { bot } from './bot/bot.js';
import { config } from './config.js';
import { startScheduler } from './jobs/scheduler.js';
import { logger } from './logger.js';
import { registerRobokassaWebhook } from './payments/webhook.js';

logger.info(
  { groupId: config.GROUP_ID.toString(), adminId: config.ADMIN_ID.toString() },
  'starting bot',
);

const fastify = Fastify({ logger: false });

await fastify.register(formbody);
registerRobokassaWebhook(fastify);

bot.catch((err) => {
  logger.error({ err: err.error }, 'bot error');
});

startScheduler();

await Promise.all([
  fastify.listen({ port: config.PORT, host: '0.0.0.0' }).then(() => {
    logger.info({ port: config.PORT }, 'fastify listening');
  }),
  bot.start({
    allowed_updates: [...API_CONSTANTS.DEFAULT_UPDATE_TYPES, 'chat_member'],
    onStart: (botInfo) => {
      logger.info({ username: botInfo.username }, 'bot started (long polling)');
    },
  }),
]);
