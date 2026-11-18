import type { Cookies } from '@sveltejs/kit';
import type { AppConfig } from '../config.ts';

export const SESSION_COOKIE = 'hd_session';
export const SETUP_COOKIE = 'hd_setup';
export const CHALLENGE_COOKIE = 'hd_challenge';

function base(config: AppConfig) {
  return { path: '/', httpOnly: true, sameSite: 'strict', secure: config.secureCookies } as const;
}

export function setSessionCookie(cookies: Cookies, config: AppConfig, token: string, expires: Date) {
  cookies.set(SESSION_COOKIE, token, { ...base(config), expires });
}

export function setShortCookie(
  cookies: Cookies,
  config: AppConfig,
  name: string,
  value: string,
  minutes: number,
) {
  cookies.set(name, value, { ...base(config), maxAge: minutes * 60 });
}

export function clearCookie(cookies: Cookies, config: AppConfig, name: string) {
  cookies.delete(name, base(config));
}
