/** Pfade, die ohne Login erreichbar sind. Alles andere erfordert eine gültige Session. */
const PUBLIC_EXACT = new Set([
  '/login',
  '/setup',
  '/api/health',
  '/api/auth/login/options',
  '/api/auth/login/verify',
  // Registrierung prüft selbst: Session ODER gültiges Setup-Token
  '/api/auth/register/options',
  '/api/auth/register/verify',
  '/manifest.webmanifest',
  '/icon.svg',
  '/robots.txt',
  '/favicon.ico',
]);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_EXACT.has(pathname) || pathname.startsWith('/_app/');
}

export const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  // same-origin statt no-referrer: sonst sendet der Browser bei Formular-POSTs "Origin: null" und der CSRF-Schutz greift.
  'referrer-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'cross-origin-opener-policy': 'same-origin',
};
