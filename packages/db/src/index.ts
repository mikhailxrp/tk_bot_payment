import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export { PrismaClient } from '@prisma/client';
export type {
  User,
  Payment,
  Admin,
  Setting,
  CommonAccess,
} from '@prisma/client';
export { UserStatus, PaymentStatus, ProductType } from '@prisma/client';
