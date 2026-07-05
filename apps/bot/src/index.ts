import Fastify from 'fastify';
import formbody from '@fastify/formbody';

import { bot } from './bot/bot.js';
import { config } from './config.js';
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

await Promise.all([
  fastify.listen({ port: config.PORT, host: '0.0.0.0' }).then(() => {
    logger.info({ port: config.PORT }, 'fastify listening');
  }),
  bot.start({
    onStart: (botInfo) => {
      logger.info({ username: botInfo.username }, 'bot started (long polling)');
    },
  }),
]);
