export interface AllocationShare<K extends string = string> {
  key: K;
  /** Nicht-negatives Gewicht, z. B. kWh-Anteil oder Prozent des fixen Schlüssels. */
  weight: number;
}

/**
 * Verteilt einen Gesamtbetrag in Cent nach Gewichten auf Parteien (Largest-Remainder-Methode).
 *
 * Garantien (property-based getestet):
 *  - Die Summe der Anteile ist exakt `totalCents`.
 *  - Jeder Anteil weicht höchstens 1 Cent vom exakten Wert ab.
 *  - Das Ergebnis hängt nicht von der Reihenfolge der Parteien ab.
 *  - Bei Gewichtssumme 0 wird gleichmäßig verteilt.
 */
export function allocateCents<K extends string>(
  totalCents: number,
  shares: readonly AllocationShare<K>[],
): Map<K, number> {
  if (!Number.isSafeInteger(totalCents)) {
    throw new RangeError(`totalCents muss eine ganze Zahl sein, war ${totalCents}`);
  }
  if (shares.length === 0) {
    throw new RangeError('Mindestens eine Partei erforderlich');
  }
  const keys = new Set<K>();
  for (const s of shares) {
    if (!Number.isFinite(s.weight) || s.weight < 0) {
      throw new RangeError(`Ungültiges Gewicht für ${s.key}: ${s.weight}`);
    }
    if (keys.has(s.key)) throw new RangeError(`Doppelte Partei: ${s.key}`);
    keys.add(s.key);
  }

  // Kanonische Reihenfolge, damit Gleitkomma-Summen nicht von der Eingabereihenfolge abhängen.
  const canonical = [...shares].sort((a, b) => compareKeys(a.key, b.key));
  const weightSum = canonical.reduce((sum, s) => sum + s.weight, 0);
  const effective =
    weightSum > 0
      ? canonical.map((s) => ({ key: s.key, weight: s.weight / weightSum }))
      : canonical.map((s) => ({ key: s.key, weight: 1 / canonical.length }));

  const sign = totalCents < 0 ? -1 : 1;
  const absTotal = Math.abs(totalCents);

  const parts = effective.map((s) => {
    const exact = absTotal * s.weight;
    const floor = Math.floor(exact);
    return { key: s.key, floor, remainder: exact - floor };
  });

  let rest = absTotal - parts.reduce((sum, p) => sum + p.floor, 0);
  // Deterministische Reihenfolge: größter Rest zuerst, bei Gleichstand nach Schlüssel.
  const order = [...parts].sort((a, b) => b.remainder - a.remainder || compareKeys(a.key, b.key));
  const result = new Map<K, number>(parts.map((p) => [p.key, p.floor]));
  for (const p of order) {
    if (rest <= 0) break;
    result.set(p.key, (result.get(p.key) ?? 0) + 1);
    rest--;
  }
  if (sign < 0) {
    for (const [k, v] of result) result.set(k, v === 0 ? 0 : -v);
  }
  return result;
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
