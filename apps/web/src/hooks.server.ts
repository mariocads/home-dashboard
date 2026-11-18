import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { isPublicPath, SECURITY_HEADERS } from '#lib/server/access.ts';
import { clearCookie, SESSION_COOKIE, setSessionCookie } from '#lib/server/auth/cookies.ts';
import { validateSession } from '#lib/server/auth/store.ts';
import { loadConfig } from '#lib/server/config.ts';
import { getDb } from '#lib/server/db.ts';

const config = loadConfig();

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.user = null;
  event.locals.sessionId = null;

  const token = event.cookies.get(SESSION_COOKIE);
  if (token) {
    const { db } = await getDb();
    const session = await validateSession(db, token, config.sessionDays);
    if (session) {
      event.locals.user = session.user;
      event.locals.sessionId = session.sessionId;
      setSessionCookie(event.cookies, config, token, session.expiresAt);
    } else {
      clearCookie(event.cookies, config, SESSION_COOKIE);
    }
  }

  const { pathname } = event.url;
  if (!event.locals.user && !isPublicPath(pathname)) {
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ message: 'Nicht angemeldet' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    redirect(303, '/login');
  }

  const response = await resolve(event);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) response.headers.set(k, v);
  if (!isPublicPath(pathname) || pathname.startsWith('/api/')) {
    response.headers.set('cache-control', 'no-store');
  }
  return response;
};
