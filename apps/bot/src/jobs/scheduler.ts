import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';

import { prisma } from '@tg-bot/db';

import { logger } from '../logger.js';
import { cronTimeMatchesNow, getMoscowCalendarDate, parseCronTime } from '../util/moscowDate.js';
import { runDailyCheck } from './dailyCheck.js';

const CRON_TIME_SETTING_KEY = 'cron_time';

let lastRunDate: string | null = null;

export function resetSchedulerDayGuardForTests(): void {
  lastRunDate = null;
}

export async function schedulerTick(now: Date = new Date()): Promise<void> {
  const setting = await prisma.setting.findUnique({
    where: { key: CRON_TIME_SETTING_KEY },
  });

  if (!setting) {
    logger.warn(
      { key: CRON_TIME_SETTING_KEY },
      'scheduler: cron_time setting not found, skipping tick',
    );
    return;
  }

  const cronTime = setting.value;
  if (!parseCronTime(cronTime)) {
    logger.warn({ cronTime }, 'scheduler: malformed cron_time, skipping tick');
    return;
  }

  if (!cronTimeMatchesNow(cronTime, now)) {
    return;
  }

  const today = getMoscowCalendarDate(now);
  if (lastRunDate === today) {
    return;
  }

  lastRunDate = today;
  await runDailyCheck();
}

export function startScheduler(): ScheduledTask {
  const task = cron.schedule(
    '* * * * *',
    () => {
      void schedulerTick().catch((err) => {
        logger.error({ err }, 'scheduler tick failed');
      });
    },
    { timezone: 'Europe/Moscow' },
  );

  logger.info({ timezone: 'Europe/Moscow' }, 'scheduler started');
  return task;
}
