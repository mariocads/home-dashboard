import type { Db } from '@hd/db';
import { schema } from '@hd/db';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { generateRecoveryCode, normalizeRecoveryCode, randomToken, sha256 } from './tokens.ts';

const { authChallenges, passkeys, recoveryCodes, sessions, setupTokens, users } = schema;

export const ADMIN_USERNAME = 'admin';
const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Benutzer ────────────────────────────────────────────────────────────────

export async function getOrCreateAdmin(db: Db) {
  const existing = await db.select().from(users).where(eq(users.username, ADMIN_USERNAME));
  if (existing[0]) return existing[0];
  const [created] = await db
    .insert(users)
    .values({ username: ADMIN_USERNAME })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await db.select().from(users).where(eq(users.username, ADMIN_USERNAME));
  return again!;
}

export async function findAdmin(db: Db) {
  const [user] = await db.select().from(users).where(eq(users.username, ADMIN_USERNAME));
  return user ?? null;
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export async function createSession(db: Db, userId: string, days: number, now = new Date()) {
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + days * DAY_MS);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  return { token, expiresAt };
}

/**
 * Prüft ein Session-Token. Verlängert die Laufzeit (sliding), wenn weniger als die Hälfte übrig ist.
 * Liefert null bei unbekannten oder abgelaufenen Tokens.
 */
export async function validateSession(db: Db, token: string, days: number, now = new Date()) {
  const id = sha256(token);
  const [row] = await db
    .select({ session: sessions, user: { id: users.id, username: users.username } })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id));
  if (!row) return null;
  if (row.session.expiresAt.getTime() <= now.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  let expiresAt = row.session.expiresAt;
  if (expiresAt.getTime() - now.getTime() < (days * DAY_MS) / 2) {
    expiresAt = new Date(now.getTime() + days * DAY_MS);
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
  }
  return { sessionId: id, user: row.user, expiresAt };
}

export async function deleteSession(db: Db, sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function purgeExpired(db: Db, now = new Date()) {
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  await db.delete(authChallenges).where(lt(authChallenges.expiresAt, now));
}

// ─── Setup-Token (Ersteinrichtung per CLI) ───────────────────────────────────

export async function createSetupToken(db: Db, validMinutes = 30, now = new Date()) {
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + validMinutes * 60_000);
  await db.insert(setupTokens).values({ tokenHash: sha256(token), expiresAt });
  return { token, expiresAt };
}

export async function isSetupTokenValid(db: Db, token: string, now = new Date()) {
  const [row] = await db
    .select()
    .from(setupTokens)
    .where(
      and(
        eq(setupTokens.tokenHash, sha256(token)),
        isNull(setupTokens.usedAt),
        gt(setupTokens.expiresAt, now),
      ),
    );
  return Boolean(row);
}

/** Markiert das Token als verbraucht; true nur beim ersten erfolgreichen Aufruf. */
export async function consumeSetupToken(db: Db, token: string, now = new Date()) {
  const updated = await db
    .update(setupTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(setupTokens.tokenHash, sha256(token)),
        isNull(setupTokens.usedAt),
        gt(setupTokens.expiresAt, now),
      ),
    )
    .returning();
  return updated.length === 1;
}

// ─── WebAuthn-Challenges ─────────────────────────────────────────────────────

export async function saveChallenge(
  db: Db,
  challenge: string,
  purpose: 'register' | 'login',
  userId: string | null,
  now = new Date(),
) {
  const id = randomToken(16);
  await db
    .insert(authChallenges)
    .values({ id, challenge, purpose, userId, expiresAt: new Date(now.getTime() + 5 * 60_000) });
  return id;
}

/** Holt und löscht eine Challenge (einmalig verwendbar). */
export async function takeChallenge(db: Db, id: string, purpose: 'register' | 'login', now = new Date()) {
  const [row] = await db.delete(authChallenges).where(eq(authChallenges.id, id)).returning();
  if (!row || row.purpose !== purpose || row.expiresAt.getTime() <= now.getTime()) return null;
  return row;
}

// ─── Passkeys ────────────────────────────────────────────────────────────────

export function listPasskeys(db: Db, userId: string) {
  return db.select().from(passkeys).where(eq(passkeys.userId, userId)).orderBy(passkeys.createdAt);
}

export async function findPasskey(db: Db, id: string) {
  const [row] = await db.select().from(passkeys).where(eq(passkeys.id, id));
  return row ?? null;
}

export async function deletePasskey(db: Db, userId: string, id: string) {
  const all = await listPasskeys(db, userId);
  if (all.length <= 1) throw new Error('Der letzte Passkey kann nicht gelöscht werden.');
  await db.delete(passkeys).where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)));
}

// ─── Recovery-Codes ──────────────────────────────────────────────────────────

export async function regenerateRecoveryCodes(db: Db, userId: string, count = 10) {
  const codes = Array.from({ length: count }, generateRecoveryCode);
  await db.transaction(async (tx) => {
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await tx.insert(recoveryCodes).values(codes.map((c) => ({ userId, codeHash: sha256(c) })));
  });
  return codes;
}

export async function countRecoveryCodes(db: Db, userId: string) {
  const rows = await db
    .select({ id: recoveryCodes.id })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
  return rows.length;
}

/** Löst einen Recovery-Code ein; liefert die User-ID oder null. */
export async function consumeRecoveryCode(db: Db, input: string, now = new Date()) {
  const code = normalizeRecoveryCode(input);
  if (!code) return null;
  const [row] = await db
    .update(recoveryCodes)
    .set({ usedAt: now })
    .where(and(eq(recoveryCodes.codeHash, sha256(code)), isNull(recoveryCodes.usedAt)))
    .returning();
  return row?.userId ?? null;
}
