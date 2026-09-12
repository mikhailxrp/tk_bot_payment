import { prisma } from '@tg-bot/db';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

import { authConfig } from './auth.config';
import { config as appConfig } from './lib/config';
import { verifyAdminLoginToken } from './lib/verifyAdminLoginToken';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { token: {} },
      async authorize(credentials) {
        const token = credentials?.token;
        if (typeof token !== 'string' || token.length === 0) {
          return null;
        }

        const verified = verifyAdminLoginToken(token, appConfig.AUTH_SECRET, new Date());
        if (!verified) {
          return null;
        }

        const admin = await prisma.admin.findUnique({
          where: { telegramId: verified.telegramId },
        });
        if (!admin) {
          return null;
        }

        return { id: admin.telegramId.toString(), name: admin.username ?? admin.telegramId.toString() };
      },
    }),
  ],
});
