import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export { PrismaClient } from '@prisma/client';
export type {
  User,
  Payment,
  Admin,
  Setting,
} from '@prisma/client';
export { UserStatus, PaymentStatus } from '@prisma/client';
