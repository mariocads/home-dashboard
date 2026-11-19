import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// ─── Authentifizierung ────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  createdAt: createdAt(),
});

/** WebAuthn-Credentials (Passkeys). */
export const passkeys = pgTable(
  'passkeys',
  {
    /** Credential-ID (base64url). */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** COSE Public Key (base64url). */
    publicKey: text('public_key').notNull(),
    counter: integer('counter').notNull().default(0),
    transports: text('transports').array().notNull().default([]),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull().default(false),
    name: text('name').notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [index('passkeys_user_idx').on(t.userId)],
);

/** Sessions; gespeichert wird nur der SHA-256-Hash des Tokens. */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/** Einmal verwendbare Recovery-Codes (Hash). */
export const recoveryCodes = pgTable('recovery_codes', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull().unique(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
});

/** Einmal-Token für die Ersteinrichtung bzw. das Hinzufügen eines Passkeys ohne Login (per CLI erzeugt). */
export const setupTokens = pgTable('setup_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
});

/** Offene WebAuthn-Challenges (kurzlebig). */
export const authChallenges = pgTable('auth_challenges', {
  id: text('id').primaryKey(),
  challenge: text('challenge').notNull(),
  purpose: text('purpose', { enum: ['register', 'login'] }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

// ─── Einstellungen ────────────────────────────────────────────────────────────

/** Einstellungen, die in der App geändert werden (Schlüssel und Validierung im domain-Paket). */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Messdaten ────────────────────────────────────────────────────────────────

/** Messstelle, z. B. Hauptzähler, Wallbox, Wärmezähler Partei A. */
export const meters = pgTable('meters', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  /** electricity | heat | cold | water | temperature | … */
  kind: text('kind').notNull(),
  unit: text('unit').notNull(),
  /** Zugeordnete Partei (null = gemeinsam). */
  party: text('party'),
  createdAt: createdAt(),
});

/**
 * Messwerte als Zeitreihe. In Produktion eine TimescaleDB-Hypertable (siehe timescale.sql).
 * Der Primärschlüssel enthält ts, wie von Timescale gefordert.
 */
export const readings = pgTable(
  'readings',
  {
    meterId: integer('meter_id')
      .notNull()
      .references(() => meters.id, { onDelete: 'cascade' }),
    /** energy_import_kwh (Intervall), power_w, counter_kwh, … */
    quantity: text('quantity').notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    value: doublePrecision('value').notNull(),
    /** netzooe_csv | amis | goe | isg | wmbus | … */
    source: text('source').notNull(),
    status: text('status').notNull().default('VALID'),
  },
  (t) => [primaryKey({ columns: [t.meterId, t.quantity, t.ts] })],
);

/**
 * Import-Protokoll (z. B. NetzOÖ-CSV). Der Dateiname wird bewusst nicht gespeichert,
 * er enthält den Zählpunkt. Der SHA-256 des Inhalts erkennt erneute Importe.
 */
export const imports = pgTable('imports', {
  id: serial('id').primaryKey(),
  source: text('source').notNull(),
  contentHash: text('content_hash').notNull(),
  fromTs: timestamp('from_ts', { withTimezone: true }),
  toTs: timestamp('to_ts', { withTimezone: true }),
  rowCount: integer('row_count').notNull(),
  inserted: integer('inserted').notNull(),
  updated: integer('updated').notNull(),
  unchanged: integer('unchanged').notNull(),
  issueCount: integer('issue_count').notNull(),
  gapCount: integer('gap_count').notNull(),
  totalKwh: doublePrecision('total_kwh').notNull(),
  createdAt: createdAt(),
});
