<script lang="ts">
  let {
    values,
    format,
    unit,
    label,
  }: {
    /** [Wochentag 0 = Mo][Stunde 0–23], null = keine Daten */
    values: (number | null)[][];
    format: (v: number) => string;
    unit: string;
    label: string;
  } = $props();

  const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const STEPS = 7;

  let selected = $state<{ d: number; h: number } | null>(null);

  const flat = $derived(values.flat().filter((v): v is number => v !== null));
  const min = $derived(flat.length ? Math.min(...flat) : 0);
  const max = $derived(flat.length ? Math.max(...flat) : 0);

  /** Stufe 0–6 der einfarbigen Skala, linear zwischen Minimum und Maximum */
  function step(v: number): number {
    if (max <= min) return 3;
    return Math.min(STEPS - 1, Math.floor(((v - min) / (max - min)) * STEPS));
  }

  function pick(event: PointerEvent) {
    const cell = (event.target as HTMLElement).dataset;
    if (cell.d !== undefined && cell.h !== undefined) selected = { d: Number(cell.d), h: Number(cell.h) };
  }

  const hours = (h: number) => `${String(h).padStart(2, '0')}–${String(h + 1).padStart(2, '0')} Uhr`;
</script>

<div class="heatmap">
  <p class="readout" aria-live="polite">
    {#if selected && values[selected.d]?.[selected.h] != null}
      <strong>{DAYS[selected.d]}, {hours(selected.h)}</strong>: Ø {format(values[selected.d]![selected.h]!)}
      {unit}
    {:else}
      <span class="muted">Feld antippen für den Wert</span>
    {/if}
  </p>
  <div
    class="grid"
    role="img"
    aria-label={label}
    onpointerdown={pick}
    onpointerover={(e) => e.pointerType === 'mouse' && pick(e)}
  >
    {#each values as row, d (d)}
      <span class="day">{DAYS[d]}</span>
      {#each row as v, h (h)}
        <span
          class="cell"
          class:empty={v === null}
          class:active={selected?.d === d && selected?.h === h}
          style:background={v === null ? undefined : `var(--seq-${step(v)})`}
          data-d={d}
          data-h={h}
        ></span>
      {/each}
    {/each}
    <span></span>
    {#each [0, 6, 12, 18] as h (h)}
      <span class="hour" style:grid-column="{h + 2} / span 6">{h}</span>
    {/each}
  </div>
  <div class="scale" aria-hidden="true">
    <span>{format(min)}</span>
    {#each Array.from({ length: STEPS }, (_, i) => i) as i (i)}
      <span class="swatch" style:background="var(--seq-{i})"></span>
    {/each}
    <span>{format(max)} {unit}</span>
  </div>
  <details>
    <summary>Werte als Tabelle</summary>
    <div class="table-wrap">
      <table>
        <caption class="sr-only">{label}</caption>
        <thead>
          <tr>
            <th scope="col">Stunde</th>
            {#each DAYS as day (day)}<th scope="col">{day}</th>{/each}
          </tr>
        </thead>
        <tbody>
          {#each Array.from({ length: 24 }, (_, h) => h) as h (h)}
            <tr>
              <th scope="row">{String(h).padStart(2, '0')}</th>
              {#each values as row, d (d)}<td>{row[h] == null ? '–' : format(row[h]!)}</td>{/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </details>
</div>

<style>
  .heatmap {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .readout {
    margin: 0;
    min-height: 1.4em;
    font-size: 0.9rem;
    font-variant-numeric: tabular-nums;
  }

  .grid {
    display: grid;
    grid-template-columns: 2em repeat(24, 1fr);
    gap: 2px;
    touch-action: pan-y;
  }

  .day,
  .hour {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1;
    align-self: center;
  }

  .cell {
    aspect-ratio: 1;
    border-radius: 3px;
    min-width: 0;
  }

  .cell.empty {
    background: var(--surface-2);
  }

  .cell.active {
    outline: 2px solid var(--text);
    outline-offset: 0;
  }

  .scale {
    display: flex;
    align-items: center;
    gap: 2px;
    font-size: 11px;
    color: var(--text-muted);
  }

  .scale > span:first-child {
    margin-right: 4px;
  }

  .scale > span:last-child {
    margin-left: 4px;
  }

  .swatch {
    width: 18px;
    height: 10px;
    border-radius: 2px;
  }

  details {
    font-size: 0.8rem;
  }

  summary {
    cursor: pointer;
    color: var(--text-muted);
  }

  .table-wrap {
    overflow-x: auto;
  }

  table {
    border-collapse: collapse;
    margin-top: 6px;
    font-variant-numeric: tabular-nums;
  }

  th,
  td {
    padding: 2px 6px;
    text-align: right;
    border-bottom: 1px solid var(--border);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
