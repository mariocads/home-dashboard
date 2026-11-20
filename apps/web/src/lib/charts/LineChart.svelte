<script lang="ts">
  import type { LinePoint } from '@hd/domain';

  export interface Series {
    label: string;
    /** CSS-Farbe, z. B. var(--series-1) */
    color: string;
    points: LinePoint[];
  }

  let {
    series,
    unit,
    format,
    tickFormat,
    label,
    height = 200,
    area = false,
    zero = false,
    testid,
  }: {
    series: Series[];
    unit: string;
    format: (v: number) => string;
    /** Beschriftung der y-Achse (Standard: format) */
    tickFormat?: (v: number) => string;
    /** Name des Diagramms (Screenreader, Tabelle) */
    label: string;
    height?: number;
    /** Fläche unter der Linie (nur bei einer Reihe sinnvoll) */
    area?: boolean;
    /** y-Achse bei 0 beginnen */
    zero?: boolean;
    testid?: string;
  } = $props();

  const time = new Intl.DateTimeFormat('de-AT', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Europe/Vienna',
  });
  /** Stunde und Minute in Wiener Zeit */
  const hm = (t: number) => time.format(t).split(':').map(Number) as [number, number];

  let width = $state(340);
  let selected = $state<number | null>(null);

  // Rechts Platz für die Namen am Linienende (bei mehreren Reihen)
  const labelled = $derived(series.length > 1);
  const pad = $derived({ top: 8, right: labelled ? 70 : 8, bottom: 22, left: 36 });
  const times = $derived(series[0]?.points.map((p) => p.t) ?? []);
  const values = $derived(series.flatMap((s) => s.points.map((p) => p.v)).filter((v) => v !== null));
  const hasData = $derived(values.length > 0);

  /** Gleichmäßige Achsenteilung mit Schritten 1, 2 oder 5 × 10^n. */
  function niceRange(min: number, max: number): number[] {
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const raw = (max - min) / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((f) => f * mag).find((s) => s >= raw)!;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks: number[] = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return ticks;
  }

  const ticks = $derived(
    hasData ? niceRange(zero ? Math.min(0, ...values) : Math.min(...values), Math.max(...values)) : [0, 1],
  );
  const yMin = $derived(ticks[0]!);
  const yMax = $derived(ticks.at(-1)!);
  const plotW = $derived(Math.max(10, width - pad.left - pad.right));
  const plotH = $derived(height - pad.top - pad.bottom);
  const x = (i: number) => pad.left + (times.length > 1 ? (i / (times.length - 1)) * plotW : 0);
  const y = (v: number) => pad.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  /** Linienzug; Lücken (null) unterbrechen die Linie. */
  function linePath(points: LinePoint[]): string {
    let d = '';
    let open = false;
    points.forEach((p, i) => {
      if (p.v === null) {
        open = false;
        return;
      }
      d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`;
      open = true;
    });
    return d;
  }

  /** Fläche bis zur Grundlinie, je zusammenhängendem Abschnitt. */
  function areaPath(points: LinePoint[]): string {
    const base = y(Math.max(yMin, 0)).toFixed(1);
    let d = '';
    let run: number[] = [];
    const flush = () => {
      if (run.length > 1) {
        d += `M${x(run[0]!).toFixed(1)},${base}`;
        for (const i of run) d += `L${x(i).toFixed(1)},${y(points[i]!.v!).toFixed(1)}`;
        d += `L${x(run.at(-1)!).toFixed(1)},${base}Z`;
      }
      run = [];
    };
    points.forEach((p, i) => (p.v === null ? flush() : run.push(i)));
    flush();
    return d;
  }

  /** Achsenbeschriftung alle drei Stunden (zur vollen Stunde, Wiener Zeit). */
  const xTicks = $derived(
    times.map((t, i) => ({ i, t })).filter(({ t }) => hm(t)[1] === 0 && hm(t)[0] % 3 === 0),
  );

  /** Namen am Ende jeder Linie, mindestens 13 px auseinander. */
  const endLabels = $derived.by(() => {
    if (!labelled) return [];
    const ends = series
      .map((s) => {
        const last = s.points.findLastIndex((p) => p.v !== null);
        return last < 0 ? null : { label: s.label, color: s.color, x: x(last), y: y(s.points[last]!.v!) };
      })
      .filter((e) => e !== null)
      .sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++) ends[k]!.y = Math.max(ends[k]!.y, ends[k - 1]!.y + 13);
    return ends;
  });

  function pick(event: PointerEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (times.length < 2) return;
    const i = Math.round(((event.clientX - rect.left - pad.left) / plotW) * (times.length - 1));
    selected = i >= 0 && i < times.length ? i : null;
  }

  /** Tabelle: ein Wert je volle Stunde */
  const rows = $derived(times.map((t, i) => ({ t, i })).filter(({ t }) => hm(t)[1] === 0));
</script>

<div class="chart" data-testid={testid}>
  {#if labelled}
    <ul class="legend" aria-label="Legende">
      {#each series as s (s.label)}
        <li><span class="key" style:background={s.color} aria-hidden="true"></span>{s.label}</li>
      {/each}
    </ul>
  {/if}
  <p class="readout" aria-live="polite">
    {#if selected !== null}
      <strong>{time.format(times[selected])}</strong>
      {#each series as s (s.label)}
        <span class="item">
          {#if labelled}<span class="key" style:background={s.color} aria-hidden="true"></span>{s.label}{/if}
          {s.points[selected]?.v != null ? `${format(s.points[selected]!.v!)} ${unit}` : '–'}
        </span>
      {/each}
    {:else if hasData}
      <span class="muted">Linie antippen für die Werte</span>
    {:else}
      <span class="muted">Keine Daten an diesem Tag</span>
    {/if}
  </p>
  <div
    class="plot"
    role="presentation"
    bind:clientWidth={width}
    onpointermove={pick}
    onpointerdown={pick}
    onpointerleave={(e) => e.pointerType === 'mouse' && (selected = null)}
  >
    <svg {width} {height} role="img" aria-label={label}>
      {#each ticks as t (t)}
        <line class="grid" x1={pad.left} x2={pad.left + plotW} y1={y(t)} y2={y(t)} />
        <text class="tick" x={pad.left - 6} y={y(t)} dy="0.32em" text-anchor="end">
          {(tickFormat ?? format)(t)}
        </text>
      {/each}
      {#each xTicks as { i, t } (t)}
        <text class="tick" x={x(i)} y={height - 6} text-anchor="middle">
          {String(hm(t)[0]).padStart(2, '0')}
        </text>
      {/each}
      {#if hasData}
        {#each series as s (s.label)}
          {#if area}
            <path d={areaPath(s.points)} fill={s.color} class="area" />
          {/if}
          <path d={linePath(s.points)} stroke={s.color} class="line" />
        {/each}
        {#each endLabels as e (e.label)}
          <text class="end" x={e.x + 6} y={e.y} dy="0.32em">{e.label}</text>
        {/each}
      {/if}
      {#if selected !== null}
        <line class="cross" x1={x(selected)} x2={x(selected)} y1={pad.top} y2={pad.top + plotH} />
        {#each series as s (s.label)}
          {@const v = s.points[selected]?.v}
          {#if v != null}
            <circle cx={x(selected)} cy={y(v)} r="4.5" fill={s.color} class="marker" />
          {/if}
        {/each}
      {/if}
    </svg>
  </div>
  <details>
    <summary>Werte als Tabelle</summary>
    <table>
      <caption class="sr-only">{label}</caption>
      <thead>
        <tr>
          <th scope="col">Uhrzeit</th>
          {#each series as s (s.label)}<th scope="col">{s.label} ({unit})</th>{/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.t)}
          <tr>
            <td>{time.format(r.t)}</td>
            {#each series as s (s.label)}
              {@const v = s.points[r.i]?.v}
              <td class="num">{v != null ? format(v) : '–'}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </details>
</div>

<style>
  .chart {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .plot {
    width: 100%;
    touch-action: pan-y;
  }

  svg {
    display: block;
    overflow: visible;
  }

  .legend {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .legend li,
  .item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .key {
    width: 12px;
    height: 3px;
    border-radius: 2px;
    display: inline-block;
  }

  .readout {
    margin: 0;
    min-height: 1.4em;
    font-size: 0.9rem;
    font-variant-numeric: tabular-nums;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
  }

  .grid {
    stroke: var(--chart-grid);
    stroke-width: 1;
  }

  .tick {
    fill: var(--text-muted);
    font-size: 11px;
  }

  .line {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .area {
    opacity: 0.15;
  }

  .end {
    fill: var(--text-muted);
    font-size: 11px;
  }

  .cross {
    stroke: var(--text-muted);
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }

  .marker {
    stroke: var(--surface);
    stroke-width: 2;
  }

  details {
    font-size: 0.85rem;
  }

  summary {
    cursor: pointer;
    color: var(--text-muted);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 6px;
  }

  th,
  td {
    text-align: left;
    padding: 4px 6px;
    border-bottom: 1px solid var(--border);
  }

  .num,
  thead th:not(:first-child) {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
