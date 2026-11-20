import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
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

/**
 * Zustand der Datenquellen im Collector (z. B. AMIS-Leser), nach jeder Abfrage aktualisiert.
 * updated_at zeigt, ob der Collector selbst noch läuft.
 */
export const adapterStatus = pgTable('adapter_status', {
  name: text('name').primaryKey(),
  /** Abgefragte Adresse, z. B. http://amis-1.fritz.box/rest */
  target: text('target'),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  /** Fehlermeldung der letzten Abfrage ohne Inhalte der Antwort; null bei Erfolg */
  lastError: text('last_error'),
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

// ─── Tarife und Kosten ────────────────────────────────────────────────────────
// Werte werden in der App erfasst oder aus einer lokalen JSON-Datei importiert, nie im Repo.

/** Preiskomponente mit Gültigkeitszeitraum; Validierung im domain-Paket (parseTariffComponent). */
export const tariffComponents = pgTable(
  'tariff_components',
  {
    id: serial('id').primaryKey(),
    payee: text('payee').notNull(),
    /** energie | netz | abgaben */
    category: text('category').notNull(),
    name: text('name').notNull(),
    /** ct_kwh | eur_year | eur_month */
    unit: text('unit').notNull(),
    priceNet: doublePrecision('price_net').notNull(),
    vatPct: doublePrecision('vat_pct').notNull().default(20),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }),
    /** { months, fromHour, toHour } oder null */
    window: jsonb('window').$type<{ months: number[]; fromHour: number; toHour: number } | null>(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('tariff_components_key').on(t.payee, t.name, t.validFrom)],
);

/** Monatliche Teilzahlungen (Akonto) je Zahlungsempfänger. */
export const installments = pgTable(
  'installments',
  {
    id: serial('id').primaryKey(),
    payee: text('payee').notNull(),
    amountGross: doublePrecision('amount_gross').notNull(),
    /** JJJJ-MM */
    fromMonth: text('from_month').notNull(),
    toMonth: text('to_month'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('installments_key').on(t.payee, t.fromMonth)],
);

/** Erfasste Rechnungen für den Abgleich mit der Berechnung. */
export const invoices = pgTable(
  'invoices',
  {
    id: serial('id').primaryKey(),
    payee: text('payee').notNull(),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }).notNull(),
    amountGross: doublePrecision('amount_gross').notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('invoices_key').on(t.payee, t.fromDate, t.toDate)],
);
