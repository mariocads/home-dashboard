<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { WP_QUANTITY as Q } from '@hd/domain';
  import LineChart from '#lib/charts/LineChart.svelte';
  import { formatDay, formatKwh, formatTime, intFormat, kwFormat } from '#lib/format.ts';
  import type { HeatPumpView } from '#lib/server/heatpump.ts';

  let { view }: { view: HeatPumpView | null } = $props();

  const now = $derived(view?.now ?? null);
  const day = $derived(view?.day ?? null);
  const v = (q: string): number | null => now?.values[q] ?? null;

  const one = new Intl.NumberFormat('de-AT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const two = new Intl.NumberFormat('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const temp = (x: number | null) => (x === null ? '–' : `${one.format(x)} °C`);
  const kwh = (x: number | null) => (x === null ? '–' : `${formatKwh(x)} kWh`);

  const inverterW = $derived(v(Q.inverterW));
  const running = $derived(inverterW !== null && inverterW > 0);

  const circuits = $derived(
    [1, 2, 3, 4]
      .map((n) => ({ n, ist: v(Q.hcC(n)), soll: v(Q.hcSetC(n)) }))
      .filter((c) => c.ist !== null || c.soll !== null),
  );
  const rooms = $derived(
    [1, 2, 3, 4, 5]
      .map((n) => ({
        n,
        ist: v(Q.roomC(n)),
        soll: v(Q.roomSetC(n)),
        humidity: v(Q.roomHumidityPct(n)),
      }))
      .filter((r) => r.ist !== null),
  );

  // Heute: alle 30 s nachladen (neue Werte höchstens im Abfrageintervall)
  $effect(() => {
    if (!day?.isToday) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void invalidateAll();
    }, 30_000);
    return () => clearInterval(id);
  });
</script>

<svelte:head><title>Wärmepumpe · Home</title></svelte:head>

<div class="stack">
  <header>
    <h1>Wärmepumpe</h1>
    {#if now}
      <p class="muted" data-testid="wp-state">
        <span class="dot" class:on={running && !now.stale} aria-hidden="true"></span>
        {#if now.stale}
          Keine aktuellen Werte · Stand {formatTime(now.ts)}
        {:else}
          {running ? `Verdichter läuft · ${kwFormat.format(inverterW! / 1000)} kW` : 'Verdichter aus'} · Stand
          {formatTime(now.ts)}
        {/if}
      </p>
    {/if}
  </header>

  {#if !view || !day}
    <section class="card">
      <p>Noch keine Daten von der Wärmepumpe.</p>
      <p class="muted small">
        Der Collector liest die Stiebel ISG über Modbus TCP. Den Zustand zeigt
        <a href={resolve('/einstellungen')}>Einstellungen → Wärmepumpe (ISG)</a>.
      </p>
    </section>
  {:else}
    {#if now}
      <section class="grid" aria-label="Aktuelle Werte">
        <article class="card tile" data-testid="wp-outdoor">
          <span class="label">Außen</span>
          <span class="value">{temp(v(Q.outdoorC))}</span>
        </article>
        <article class="card tile" data-testid="wp-flow">
          <span class="label">Vorlauf / Rücklauf</span>
          <span class="value">{temp(v(Q.flowC))}</span>
          <span class="hint muted">Rücklauf {temp(v(Q.returnC))}</span>
        </article>
        <article class="card tile" data-testid="wp-dhw">
          <span class="label">Warmwasser</span>
          <span class="value">{temp(v(Q.dhwC))}</span>
          <span class="hint muted">Soll {temp(v(Q.dhwSetC))}</span>
        </article>
        <article class="card tile" data-testid="wp-efficiency">
          <span class="label">Effizienz Heizen, 12 Mon.</span>
          <span class="value">
            {v(Q.efficiencyHeating12m) !== null ? two.format(v(Q.efficiencyHeating12m)!) : '–'}
          </span>
          <span class="hint muted">
            Warmwasser {v(Q.efficiencyDhw12m) !== null ? two.format(v(Q.efficiencyDhw12m)!) : '–'}
          </span>
        </article>
      </section>
    {/if}

    <div class="pager">
      <a
        class="arrow"
        href={resolve('/waermepumpe/[date]', { date: day.prevKey })}
        aria-label="Vorheriger Tag"
        data-sveltekit-noscroll
      >
        ‹
      </a>
      <h2 data-testid="wp-day">{day.isToday ? 'Heute' : formatDay(day.start)}</h2>
      {#if day.nextKey}
        <a
          class="arrow"
          href={resolve('/waermepumpe/[date]', { date: day.nextKey })}
          aria-label="Nächster Tag"
          data-sveltekit-noscroll
        >
          ›
        </a>
      {:else}
        <span class="arrow disabled" aria-hidden="true">›</span>
      {/if}
    </div>

    <section class="card stack" aria-labelledby="energy-heading">
      <h2 id="energy-heading" class="sr-only">Energie am Tag</h2>
      <div class="kpis">
        <div>
          <span class="label">Wärme</span>
          <span class="value" data-testid="wp-heat">{kwh(day.energy.heatKwh)}</span>
        </div>
        <div>
          <span class="label">Strom</span>
          <span class="value" data-testid="wp-power">{kwh(day.energy.powerKwh)}</span>
        </div>
        <div>
          <span class="label">Arbeitszahl</span>
          <span class="value" data-testid="wp-ratio">
            {day.energy.ratio !== null ? two.format(day.energy.ratio) : '–'}
          </span>
        </div>
      </div>
      <table class="split">
        <thead>
          <tr><th scope="col"></th><th scope="col">Wärme</th><th scope="col">Strom</th></tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Heizen</th>
            <td>{kwh(day.energy.heatHeatingKwh)}</td>
            <td>{kwh(day.energy.powerHeatingKwh)}</td>
          </tr>
          <tr>
            <th scope="row">Warmwasser</th>
            <td>{kwh(day.energy.heatDhwKwh)}</td>
            <td>{kwh(day.energy.powerDhwKwh)}</td>
          </tr>
        </tbody>
      </table>
      <p class="muted small">
        Aus den Zählern der Wärmepumpe in ganzen kWh, vom Regler berechnet. Die Arbeitszahl erscheint ab 3 kWh
        Strom.
      </p>
    </section>

    <section class="card stack" aria-labelledby="temps-heading">
      <h2 id="temps-heading">Temperaturen</h2>
      <LineChart
        label="Vorlauf, Rücklauf und Außentemperatur im Tagesverlauf"
        unit="°C"
        format={(x) => one.format(x)}
        tickFormat={(x) => intFormat.format(x)}
        testid="wp-temps"
        series={[
          { label: 'Vorlauf', color: 'var(--series-1)', points: day.temps.flow },
          { label: 'Rücklauf', color: 'var(--series-2)', points: day.temps.return },
          { label: 'Außen', color: 'var(--series-3)', points: day.temps.outdoor },
        ]}
      />
    </section>

    <section class="card stack" aria-labelledby="power-heading">
      <h2 id="power-heading">Leistungsaufnahme Verdichter</h2>
      <LineChart
        label="Leistungsaufnahme des Verdichters im Tagesverlauf"
        unit="kW"
        format={(x) => one.format(x)}
        area
        zero
        height={150}
        testid="wp-power-chart"
        series={[{ label: 'Leistung', color: 'var(--chart-bar)', points: day.powerKw }]}
      />
    </section>

    {#if now && (circuits.length > 0 || rooms.length > 0)}
      <section class="card stack" aria-labelledby="circuits-heading">
        <h2 id="circuits-heading">Heizkreise</h2>
        <table class="split" data-testid="wp-circuits">
          <thead>
            <tr><th scope="col"></th><th scope="col">Ist</th><th scope="col">Soll</th></tr>
          </thead>
          <tbody>
            {#each circuits as c (c.n)}
              <tr><th scope="row">Heizkreis {c.n}</th><td>{temp(c.ist)}</td><td>{temp(c.soll)}</td></tr>
            {/each}
            <tr><th scope="row">Puffer</th><td>{temp(v(Q.bufferC))}</td><td>{temp(v(Q.bufferSetC))}</td></tr>
            {#each rooms as r (r.n)}
              <tr>
                <th scope="row">
                  Raum Heizkreis {r.n}
                  {#if r.humidity !== null}<span class="muted small">
                      {` · ${one.format(r.humidity)} %`}
                    </span>{/if}
                </th>
                <td>{temp(r.ist)}</td>
                <td>{temp(r.soll)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
    {/if}

    {#if now}
      <details class="card">
        <summary>Kältekreis und Zähler</summary>
        <dl class="facts">
          <dt>Heißgas</dt>
          <dd>{temp(v(Q.hotGasC))}</dd>
          <dt>Niederdruck / Mitteldruck / Hochdruck</dt>
          <dd>
            {[Q.lowPressureBar, Q.midPressureBar, Q.highPressureBar]
              .map((q) => (v(q) !== null ? two.format(v(q)!) : '–'))
              .join(' / ')} bar
          </dd>
          <dt>Volumenstrom</dt>
          <dd>{v(Q.flowRateLpm) !== null ? `${one.format(v(Q.flowRateLpm)!)} l/min` : '–'}</dd>
          <dt>Verdichterstarts</dt>
          <dd>{v(Q.compressorStarts) !== null ? intFormat.format(v(Q.compressorStarts)!) : '–'}</dd>
          <dt>Laufzeit Heizen / Warmwasser</dt>
          <dd>
            {v(Q.runtimeHeatingH) !== null ? intFormat.format(v(Q.runtimeHeatingH)!) : '–'} h /
            {v(Q.runtimeDhwH) !== null ? intFormat.format(v(Q.runtimeDhwH)!) : '–'} h
          </dd>
          <dt>Wärme gesamt Heizen / Warmwasser</dt>
          <dd>{kwh(v(Q.heatHeatingKwh))} / {kwh(v(Q.heatDhwKwh))}</dd>
          <dt>Strom gesamt Heizen / Warmwasser</dt>
          <dd>{kwh(v(Q.powerHeatingKwh))} / {kwh(v(Q.powerDhwKwh))}</dd>
        </dl>
      </details>
    {/if}
  {/if}
</div>

<style>
  header p {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--text-muted);
  }

  .dot.on {
    background: var(--ok);
  }

  .tile {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .label {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .value {
    font-size: 1.5rem;
    font-weight: 700;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .hint {
    font-size: 0.8rem;
  }

  .small {
    font-size: 0.8rem;
  }

  .pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .pager h2 {
    margin: 0;
    font-size: 1.05rem;
    text-align: center;
  }

  .arrow {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    font-size: 1.6rem;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    text-decoration: none;
    color: var(--text);
  }

  .arrow.disabled {
    opacity: 0.35;
  }

  .kpis {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .kpis > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .kpis .value {
    font-size: 1.25rem;
  }

  .split {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }

  .split th,
  .split td {
    padding: 6px 4px;
    border-bottom: 1px solid var(--border);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .split th[scope='row'],
  .split thead th:first-child {
    text-align: left;
    font-weight: 400;
  }

  .split thead th {
    color: var(--text-muted);
    font-weight: 400;
    font-size: 0.8rem;
  }

  details summary {
    cursor: pointer;
    font-weight: 600;
  }

  .facts {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 6px 12px;
    margin: 12px 0 0;
    font-size: 0.9rem;
  }

  .facts dt {
    color: var(--text-muted);
  }

  .facts dd {
    margin: 0;
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
