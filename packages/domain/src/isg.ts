// Stiebel Eltron ISG (Internet Service Gateway) an einem WPMsystem-Regler, gelesen über Modbus TCP.
// Registernummern wie in der Stiebel-Doku (1-basiert); Protokolladresse = Nummer − 1.
// Die Zuordnung ist am 20.11.2026 gegen die lokale SERVICEWELT geprüft (siehe docs/WAERMEPUMPE.md).

/** Wärmepumpe als Messstelle in meters. */
export const WP_METER = {
  slug: 'waermepumpe',
  name: 'Wärmepumpe',
  kind: 'heatpump',
  unit: 'kWh',
} as const;

export const ISG_SOURCE = 'isg';

/** Zu lesende Blöcke [erstes Register, Anzahl]; höchstens 125 Register je Anfrage. */
export const ISG_BLOCKS: readonly (readonly [number, number])[] = [
  [501, 113], // Ist-Werte: Temperaturen, Drücke, Heizkreise, Räume (501–613)
  [2501, 1], // Betriebsstatus (Bitfeld)
  [3501, 16], // Wärmemengen und Stromaufnahme, Summen (kWh + MWh)
  [3644, 98], // Laufzeiten, Inverter-Leistung, Effizienz, Verdichterstarts (3644–3741)
];

/** Größen in readings.quantity für die Wärmepumpe. */
export const WP_QUANTITY = {
  outdoorC: 'temp_outdoor_c',
  flowC: 'temp_flow_c',
  returnC: 'temp_return_c',
  hotGasC: 'temp_hot_gas_c',
  bufferC: 'temp_buffer_c',
  bufferSetC: 'temp_buffer_set_c',
  dhwC: 'temp_dhw_c',
  dhwSetC: 'temp_dhw_set_c',
  lowPressureBar: 'pressure_low_bar',
  midPressureBar: 'pressure_mid_bar',
  highPressureBar: 'pressure_high_bar',
  flowRateLpm: 'flow_rate_lpm',
  /** Heizkreise 1–4: temp_hc{n}_c / temp_hc{n}_set_c */
  hcC: (n: number) => `temp_hc${n}_c`,
  hcSetC: (n: number) => `temp_hc${n}_set_c`,
  /** Raumwerte der Heizkreise 1–5 (Raumfühler bzw. Fernbedienung) */
  roomC: (n: number) => `temp_room${n}_c`,
  roomSetC: (n: number) => `temp_room${n}_set_c`,
  roomHumidityPct: (n: number) => `humidity_room${n}_pct`,
  roomDewPointC: (n: number) => `temp_room${n}_dew_point_c`,
  statusBits: 'status_bits',
  heatHeatingKwh: 'counter_heat_heating_kwh',
  heatDhwKwh: 'counter_heat_dhw_kwh',
  heatBackupHeatingKwh: 'counter_heat_backup_heating_kwh',
  heatBackupDhwKwh: 'counter_heat_backup_dhw_kwh',
  powerHeatingKwh: 'counter_power_heating_kwh',
  powerDhwKwh: 'counter_power_dhw_kwh',
  runtimeHeatingH: 'counter_runtime_heating_h',
  runtimeDhwH: 'counter_runtime_dhw_h',
  compressorStarts: 'counter_compressor_starts',
  /** Leistungsaufnahme des Inverters (Verdichter), vom Regler berechnet */
  inverterW: 'power_inverter_w',
  /** Effizienz der letzten 12 Monate (Wärme ÷ Strom), vom Regler berechnet */
  efficiencyHeating12m: 'efficiency_heating_12m',
  efficiencyDhw12m: 'efficiency_dhw_12m',
} as const;

export interface IsgReading {
  quantity: string;
  ts: Date;
  value: number;
}

/** Rohwerte der Register, Schlüssel = Registernummer, Wert 0…65535. */
export type IsgRegisters = ReadonlyMap<number, number>;

/** Nicht vorhanden (0x8000) bzw. aus (0x9000) und weitere Sonderwerte in diesem Bereich. */
function unavailable(raw: number): boolean {
  return raw >= 0x8000 && raw <= 0x9fff;
}

/** Vorzeichenbehafteter Wert × Faktor, oder null. */
function signed(regs: IsgRegisters, reg: number, factor: number): number | null {
  const raw = regs.get(reg);
  if (raw === undefined || unavailable(raw)) return null;
  return round((raw > 0x7fff ? raw - 0x10000 : raw) * factor);
}

/** Vorzeichenloser Wert × Faktor, oder null (0x8000 = nicht vorhanden). */
function unsigned(regs: IsgRegisters, reg: number, factor = 1): number | null {
  const raw = regs.get(reg);
  if (raw === undefined || raw === 0x8000) return null;
  return round(raw * factor);
}

/** Zählerpaar: Register lo = Tausendstel, Register hi = Tausender, Ergebnis = hi × 1000 + lo. */
function pair(regs: IsgRegisters, lo: number, hi: number): number | null {
  const l = regs.get(lo);
  const h = regs.get(hi);
  if (l === undefined || h === undefined || unavailable(l) || unavailable(h) || l > 999) return null;
  return h * 1000 + l;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

type Rule = [quantity: string, read: (regs: IsgRegisters) => number | null];

const T = 0.1; // Temperaturen, Feuchte, Volumenstrom: Zehntel
const P = 0.01; // Drücke: Hundertstel

const RULES: Rule[] = [
  [WP_QUANTITY.outdoorC, (r) => signed(r, 507, T)],
  [WP_QUANTITY.hcC(1), (r) => signed(r, 508, T)],
  [WP_QUANTITY.hcSetC(1), (r) => signed(r, 510, T)],
  [WP_QUANTITY.hcC(2), (r) => signed(r, 511, T)],
  [WP_QUANTITY.hcSetC(2), (r) => signed(r, 512, T)],
  [WP_QUANTITY.hcC(3), (r) => signed(r, 610, T)],
  [WP_QUANTITY.hcSetC(3), (r) => signed(r, 611, T)],
  [WP_QUANTITY.hcC(4), (r) => signed(r, 612, T)],
  [WP_QUANTITY.hcSetC(4), (r) => signed(r, 613, T)],
  [WP_QUANTITY.bufferC, (r) => signed(r, 518, T)],
  [WP_QUANTITY.bufferSetC, (r) => signed(r, 519, T)],
  [WP_QUANTITY.dhwC, (r) => signed(r, 522, T)],
  [WP_QUANTITY.dhwSetC, (r) => signed(r, 523, T)],
  // Wärmepumpe 1
  [WP_QUANTITY.returnC, (r) => signed(r, 542, T)],
  [WP_QUANTITY.flowC, (r) => signed(r, 543, T)],
  [WP_QUANTITY.hotGasC, (r) => signed(r, 544, T)],
  [WP_QUANTITY.lowPressureBar, (r) => signed(r, 545, P)],
  [WP_QUANTITY.midPressureBar, (r) => signed(r, 546, P)],
  [WP_QUANTITY.highPressureBar, (r) => signed(r, 547, P)],
  [WP_QUANTITY.flowRateLpm, (r) => signed(r, 548, T)],
  // Räume der Heizkreise 1–5 ab 584, je 4 Register
  ...[1, 2, 3, 4, 5].flatMap((n): Rule[] => {
    const base = 584 + (n - 1) * 4;
    return [
      [WP_QUANTITY.roomC(n), (r) => signed(r, base, T)],
      [WP_QUANTITY.roomSetC(n), (r) => signed(r, base + 1, T)],
      [WP_QUANTITY.roomHumidityPct(n), (r) => signed(r, base + 2, T)],
      [WP_QUANTITY.roomDewPointC(n), (r) => signed(r, base + 3, T)],
    ];
  }),
  [WP_QUANTITY.statusBits, (r) => unsigned(r, 2501)],
  // Summenzähler: kWh-Rest + MWh
  [WP_QUANTITY.heatHeatingKwh, (r) => pair(r, 3502, 3503)],
  [WP_QUANTITY.heatDhwKwh, (r) => pair(r, 3505, 3506)],
  [WP_QUANTITY.heatBackupHeatingKwh, (r) => pair(r, 3507, 3508)],
  [WP_QUANTITY.heatBackupDhwKwh, (r) => pair(r, 3509, 3510)],
  [WP_QUANTITY.powerHeatingKwh, (r) => pair(r, 3512, 3513)],
  [WP_QUANTITY.powerDhwKwh, (r) => pair(r, 3515, 3516)],
  [WP_QUANTITY.runtimeHeatingH, (r) => unsigned(r, 3644)],
  [WP_QUANTITY.runtimeDhwH, (r) => unsigned(r, 3645)],
  [WP_QUANTITY.inverterW, (r) => unsigned(r, 3680, 100)],
  [WP_QUANTITY.efficiencyHeating12m, (r) => unsigned(r, 3727, 0.01)],
  [WP_QUANTITY.efficiencyDhw12m, (r) => unsigned(r, 3733, 0.01)],
  [WP_QUANTITY.compressorStarts, (r) => pair(r, 3740, 3741)],
];

/** Übersetzt die gelesenen Register in Messwerte. Nicht vorhandene Werte entfallen. */
export function isgRegistersToReadings(regs: IsgRegisters, ts: Date): IsgReading[] {
  const out: IsgReading[] = [];
  for (const [quantity, read] of RULES) {
    const value = read(regs);
    if (value !== null) out.push({ quantity, ts, value });
  }
  return out;
}

/** Ordnet die Antworten der Blöcke ihren Registernummern zu. */
export function registersFromBlocks(blocks: readonly { start: number; values: readonly number[] }[]) {
  const regs = new Map<number, number>();
  for (const { start, values } of blocks) values.forEach((v, i) => regs.set(start + i, v));
  return regs;
}
