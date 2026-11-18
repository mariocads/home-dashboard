import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isPublicPath } from './access.ts';
import { generateRecoveryCode, normalizeRecoveryCode, randomToken, sha256 } from './auth/tokens.ts';
import { loadConfig } from './config.ts';
import { RateLimiter } from './ratelimit.ts';

describe('tokens', () => {
  it('randomToken ist base64url und eindeutig', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });

  it('sha256 ist deterministisch (hex)', () => {
    expect(sha256('x')).toBe(sha256('x'));
    expect(sha256('x')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('Property: generierte Recovery-Codes überstehen Normalisierung unverändert', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const code = generateRecoveryCode();
        expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
        expect(normalizeRecoveryCode(code)).toBe(code);
      }),
      { numRuns: 500 },
    );
  });

  it('Property: Normalisierung ignoriert Groß/Klein, Leerzeichen und Bindestriche', () => {
    fc.assert(
      fc.property(
        fc.constant(null),
        fc.array(fc.constantFrom(' ', '-', ''), { minLength: 12, maxLength: 12 }),
        (_, seps) => {
          const code = generateRecoveryCode();
          const raw = code.replaceAll('-', '');
          const messy = [...raw].map((c, i) => (i % 2 ? c.toLowerCase() : c) + seps[i]).join('');
          expect(normalizeRecoveryCode(messy)).toBe(code);
        },
      ),
    );
  });

  it('verwechselbare Zeichen und ungültige Eingaben', () => {
    expect(normalizeRecoveryCode('OOOO-IIII-LLLL')).toBe('0000-1111-1111');
    expect(normalizeRecoveryCode('UUUU-UUUU-UUUU')).toBe('');
    expect(normalizeRecoveryCode('zu-kurz')).toBe('');
  });
});

describe('access', () => {
  it.each(['/login', '/setup', '/api/health', '/_app/immutable/x.js', '/api/auth/login/options'])(
    '%s ist öffentlich',
    (p) => expect(isPublicPath(p)).toBe(true),
  );
  it.each(['/', '/strom', '/einstellungen', '/api/data', '/login/../einstellungen', '/loginx'])(
    '%s erfordert Login',
    (p) => expect(isPublicPath(p)).toBe(false),
  );
});

describe('config', () => {
  it('leitet RP-ID und Secure-Cookies aus ORIGIN ab', () => {
    const c = loadConfig({ ORIGIN: 'https://home.fritz.box', DATABASE_URL: 'postgres://x' });
    expect(c).toMatchObject({
      rpId: 'home.fritz.box',
      origin: 'https://home.fritz.box',
      secureCookies: true,
    });
  });
  it('Defaults für lokale Entwicklung', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ rpId: 'localhost', secureCookies: false, sessionDays: 30 });
    expect(c.databaseUrl).toMatch(/^pglite:\/\//);
  });
});

describe('RateLimiter', () => {
  it('erlaubt limit Aufrufe pro Fenster, danach wieder frei', () => {
    const rl = new RateLimiter(2, 1000);
    expect([rl.take('a', 0), rl.take('a', 1), rl.take('a', 2)]).toEqual([true, true, false]);
    expect(rl.take('b', 2)).toBe(true);
    expect(rl.take('a', 1001)).toBe(true);
  });
});
