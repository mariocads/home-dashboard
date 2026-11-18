import { createHash, randomBytes } from 'node:crypto';

/** Kryptografisch zufälliges Token (base64url). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// Crockford-Base32 ohne leicht verwechselbare Zeichen (I, L, O, U)
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Recovery-Code im Format XXXX-XXXX-XXXX (60 Bit Entropie). */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => ALPHABET[b % 32]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

/** Vereinheitlicht Benutzereingaben: Groß/Klein, Leerzeichen, Bindestriche, verwechselbare Zeichen. */
export function normalizeRecoveryCode(input: string): string {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '').replace(/[O]/g, '0').replace(/[IL]/g, '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{12}$/.test(cleaned)) return '';
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}-${cleaned.slice(8, 12)}`;
}
