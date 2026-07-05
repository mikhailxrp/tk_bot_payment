import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_SETTINGS = [
  { key: 'price', value: '990' },
  { key: 'period_days', value: '30' },
  { key: 'remind_days', value: '3' },
  { key: 'muted_remind_days', value: '10' },
  { key: 'cron_time', value: '09:00' },
  { key: 'price_common', value: '500' },
] as const;

async function main(): Promise<void> {
  const adminId = process.env.ADMIN_ID;
  if (!adminId) {
    throw new Error('ADMIN_ID is required in environment');
  }

  for (const setting of DEFAULT_SETTINGS) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      create: { key: setting.key, value: setting.value },
      update: {},
    });
  }

  const telegramId = BigInt(adminId);
  await prisma.admin.upsert({
    where: { telegramId },
    create: { telegramId },
    update: {},
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
