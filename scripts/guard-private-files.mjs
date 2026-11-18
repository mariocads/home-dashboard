#!/usr/bin/env node
/**
 * Schutz vor dem versehentlichen Veröffentlichen privater Daten im öffentlichen Repo.
 *
 * Blockiert:
 *  - jede Datei unterhalb eines Ordners namens "prep" (beliebige Tiefe, beliebige Schreibweise)
 *  - .env-Dateien (außer .env.example)
 *  - NetzOÖ-Rohexporte ("Managerdaten_*")
 *  - Inhalte mit einer österreichischen Zählpunktnummer (AT + 31 Zeichen)
 *
 * Aufruf:  node scripts/guard-private-files.mjs --staged   (Pre-Commit-Hook)
 *          node scripts/guard-private-files.mjs --all      (CI, prüft alle getrackten Dateien)
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Österreichische Zählpunktbezeichnung: "AT" + 6 Ziffern Netzbetreiber + 25 alphanumerische Zeichen. */
export const METERING_POINT_PATTERN = /\bAT\d{6}[0-9A-Z]{25}\b/;

/** Liefert einen Grund, warum der Pfad blockiert ist, oder null. */
export function checkPath(path) {
  const normalized = path.replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (segments.slice(0, -1).some((s) => s.toLowerCase() === 'prep')) {
    return 'liegt im privaten Ordner "prep"';
  }
  const name = segments.at(-1) ?? '';
  if (/^\.env(\..+)?$/.test(name) && name !== '.env.example') {
    return 'ist eine .env-Datei mit Secrets';
  }
  if (/^managerdaten_/i.test(name)) {
    return 'ist ein NetzOÖ-Rohexport';
  }
  if (METERING_POINT_PATTERN.test(name)) {
    return 'enthält eine Zählpunktnummer im Dateinamen';
  }
  return null;
}

/** Liefert einen Grund, warum der Inhalt blockiert ist, oder null. */
export function checkContent(content) {
  if (METERING_POINT_PATTERN.test(content)) {
    return 'enthält eine Zählpunktnummer';
  }
  return null;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function listFiles(mode) {
  const out =
    mode === '--staged'
      ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
      : git(['ls-files', '-z']);
  return out.split('\0').filter(Boolean);
}

function readFile(mode, path) {
  try {
    return mode === '--staged' ? git(['show', `:${path}`]) : git(['show', `HEAD:${path}`]);
  } catch {
    return '';
  }
}

function main() {
  const mode = process.argv[2] ?? '--staged';
  if (mode !== '--staged' && mode !== '--all') {
    console.error('Aufruf: guard-private-files.mjs --staged|--all');
    process.exit(2);
  }
  const violations = [];
  for (const path of listFiles(mode)) {
    const pathReason = checkPath(path);
    if (pathReason) {
      violations.push(`${path}: ${pathReason}`);
      continue;
    }
    if (/\.(png|jpe?g|ico|webp|woff2?|gz|zip)$/i.test(path)) continue;
    const contentReason = checkContent(readFile(mode, path));
    if (contentReason) violations.push(`${path}: ${contentReason}`);
  }
  if (violations.length > 0) {
    console.error('\n✖ Private Daten gefunden – Commit/Build abgebrochen:\n');
    for (const v of violations) console.error(`  • ${v}`);
    console.error('\nDateien aus dem Index entfernen: git rm --cached <datei>\n');
    process.exit(1);
  }
  console.log(`✔ guard-private-files: keine privaten Daten gefunden (${mode}).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
