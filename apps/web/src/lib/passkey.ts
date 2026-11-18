import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(data?.message ?? `Fehler ${res.status}`);
  }
  return (await res.json()) as T;
}

export function passkeysSupported(): boolean {
  return browserSupportsWebAuthn();
}

/** Registriert einen neuen Passkey. Liefert beim ersten Passkey die Recovery-Codes. */
export async function registerPasskey(name: string): Promise<{ recoveryCodes: string[] | null }> {
  const optionsJSON = await post<Parameters<typeof startRegistration>[0]['optionsJSON']>(
    '/api/auth/register/options',
  );
  const response = await startRegistration({ optionsJSON });
  return post('/api/auth/register/verify', { response, name });
}

export async function loginWithPasskey(): Promise<void> {
  const optionsJSON =
    await post<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/api/auth/login/options');
  const response = await startAuthentication({ optionsJSON });
  await post('/api/auth/login/verify', { response });
}

export function describeError(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === 'NotAllowedError') return 'Vorgang abgebrochen oder Zeit abgelaufen.';
    if (e.name === 'InvalidStateError') return 'Dieser Passkey ist bereits registriert.';
    return e.message;
  }
  return 'Unbekannter Fehler';
}

export function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Passkey';
}
