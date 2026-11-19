<script lang="ts">
  import { niceTicks } from '@hd/domain';

  export interface Bar {
    /** kurze Achsenbeschriftung */
    axis: string;
    /** ausführliche Bezeichnung (Detailzeile, Tabelle) */
    detail: string;
    value: number;
    /** Periode nur teilweise mit Daten belegt */
    incomplete?: boolean;
  }

  let {
    bars,
    unit,
    format,
    label,
    axisEvery = 1,
    height = 190,
    testid,
  }: {
    bars: Bar[];
    unit: string;
    format: (v: number) => string;
    /** Name des Diagramms (Screenreader, Tabelle) */
    label: string;
    /** nur jede n-te Achsenbeschriftung zeigen */
    axisEvery?: number;
    height?: number;
    testid?: string;
  } = $props();

  const uid = $props.id();
  let width = $state(340);
  let selected = $state<number | null>(null);

  const pad = { top: 8, right: 4, bottom: 22, left: 40 };
  const ticks = $derived(niceTicks(Math.max(0, ...bars.map((b) => b.value))));
  const yMax = $derived(ticks.at(-1)!);
  const plotW = $derived(Math.max(10, width - pad.left - pad.right));
  const plotH = $derived(height - pad.top - pad.bottom);
  const slot = $derived(plotW / Math.max(1, bars.length));
  // Balken höchstens 24 px breit, 2 px Abstand zum Nachbarn
  const barW = $derived(Math.max(1, Math.min(24, slot - 2)));
  const y = (v: number) => pad.top + plotH - (v / yMax) * plotH;
  const hasIncomplete = $derived(bars.some((b) => b.incomplete));
  const current = $derived(selected !== null ? bars[selected] : undefined);

  /** Balken mit 4 px gerundetem oberen Ende, unten eckig an der Grundlinie. */
  function barPath(i: number, v: number): string {
    const x = pad.left + i * slot + (slot - barW) / 2;
    const top = y(v);
    const base = pad.top + plotH;
    const r = Math.min(4, barW / 2, base - top);
    if (base - top <= 0) return '';
    return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + barW - r}Q${x + barW},${top} ${x + barW},${top + r}V${base}Z`;
  }

  function pick(event: PointerEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const i = Math.floor((event.clientX - rect.left - pad.left) / slot);
    selected = i >= 0 && i < bars.length ? i : null;
  }
</script>

<div class="chart" data-testid={testid}>
  <p class="readout" aria-live="polite">
    {#if current}
      <strong>{current.detail}</strong>: {format(current.value)}
      {unit}{current.incomplete ? ' (unvollständig)' : ''}
    {:else}
      <span class="muted">Balken antippen für den Wert</span>
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
      <defs>
        <pattern
          id="hatch-{uid}"
          width="5"
          height="5"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="5" height="5" class="hatch-bg" />
          <line x1="0" y1="0" x2="0" y2="5" class="hatch-line" />
        </pattern>
      </defs>
      {#each ticks as t (t)}
        <line class="grid" x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} />
        <text class="tick" x={pad.left - 6} y={y(t)} dy="0.32em" text-anchor="end">{format(t)}</text>
      {/each}
      {#each bars as b, i (i)}
        <path
          d={barPath(i, b.value)}
          class="bar"
          class:dim={selected !== null && selected !== i}
          fill={b.incomplete ? `url(#hatch-${uid})` : 'var(--chart-bar)'}
        />
        {#if i % axisEvery === 0}
          <text class="tick" x={pad.left + i * slot + slot / 2} y={height - 6} text-anchor="middle">
            {b.axis}
          </text>
        {/if}
      {/each}
    </svg>
  </div>
  {#if hasIncomplete}
    <p class="legend muted">
      <span class="swatch" aria-hidden="true"></span> schraffiert = noch nicht vollständig
    </p>
  {/if}
  <details>
    <summary>Werte als Tabelle</summary>
    <table>
      <caption class="sr-only">{label}</caption>
      <thead><tr><th scope="col">Zeitraum</th><th scope="col">{unit}</th></tr></thead>
      <tbody>
        {#each bars as b, i (i)}
          <tr>
            <td>{b.detail}{b.incomplete ? ' *' : ''}</td>
            <td class="num">{format(b.value)}</td>
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
  }

  .readout {
    margin: 0;
    min-height: 1.4em;
    font-size: 0.9rem;
    font-variant-numeric: tabular-nums;
  }

  .grid {
    stroke: var(--chart-grid);
    stroke-width: 1;
  }

  .tick {
    fill: var(--text-muted);
    font-size: 11px;
  }

  .bar.dim {
    opacity: 0.45;
  }

  .hatch-bg {
    fill: var(--chart-bar);
    opacity: 0.35;
  }

  .hatch-line {
    stroke: var(--chart-bar);
    stroke-width: 2;
  }

  .legend {
    margin: 0;
    font-size: 0.8rem;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    background: repeating-linear-gradient(
      45deg,
      var(--chart-bar) 0 2px,
      color-mix(in srgb, var(--chart-bar) 35%, transparent) 2px 5px
    );
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

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  thead th:last-child {
    text-align: right;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
