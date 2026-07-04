import { config } from './config.js';
import { logger } from './logger.js';

logger.info({ groupId: config.GROUP_ID.toString(), adminId: config.ADMIN_ID.toString() }, 'bot started');
