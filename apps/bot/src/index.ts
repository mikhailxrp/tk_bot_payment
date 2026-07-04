import { bot } from './bot/bot.js';
import { config } from './config.js';
import { logger } from './logger.js';

logger.info(
  { groupId: config.GROUP_ID.toString(), adminId: config.ADMIN_ID.toString() },
  'starting bot',
);

bot.catch((err) => {
  logger.error({ err: err.error }, 'bot error');
});

await bot.start({
  onStart: (botInfo) => {
    logger.info({ username: botInfo.username }, 'bot started (long polling)');
  },
});
