import type { NextAuthConfig } from 'next-auth';

/**
 * Edge-safe half of the Auth.js config (used directly by `middleware.ts`, which runs on the
 * Edge runtime and cannot bundle `node:crypto`/Prisma). No providers here — those live in
 * `auth.ts` and only run in Node.js request handlers (API route, server components).
 */
export const authConfig = {
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
  },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = Boolean(auth?.user);
      const isLoginPage = request.nextUrl.pathname.startsWith('/login');

      if (isLoginPage) {
        return true;
      }
      return isLoggedIn;
    },
  },
} satisfies NextAuthConfig;
