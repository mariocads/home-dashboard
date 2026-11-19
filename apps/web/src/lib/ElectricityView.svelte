<script lang="ts">
  import { resolve } from '$app/paths';
  import BarChart, { type Bar } from '#lib/charts/BarChart.svelte';
  import Heatmap from '#lib/charts/Heatmap.svelte';
  import {
    bucketLabels,
    formatDateTime,
    formatTime,
    intFormat,
    kwFormat,
    kwhFormat,
    periodLabel,
    type View,
  } from '#lib/format.ts';
  import type { ElectricityView } from '#lib/server/energy.ts';

  let { data }: { data: ElectricityView } = $props();

  const VIEW_LABELS: Record<View, string> = { day: 'Tag', week: 'Woche', month: 'Monat', year: 'Jahr' };

  const hasData = $derived(data.stats.intervals > 0);
  const bars = $derived<Bar[]>(
    data.buckets.map((b) => {
      const labels = bucketLabels(data.view, b.start);
      // Tagesansicht: Ø-Leistung je Viertelstunde in kW, sonst Energie je Balken in kWh
      const value = data.view === 'day' ? b.kwh * 4 : b.kwh;
      return { ...labels, value, incomplete: b.intervals > 0 && b.intervals < b.expected };
    }),
  );
  const chartUnit = $derived(data.view === 'day' ? 'kW' : 'kWh');
  const axisEvery = $derived({ day: 16, week: 1, month: 5, year: 1 }[data.view]);
  const baseLoadBars = $derived<Bar[]>(
    data.baseLoad.points.map((d) => ({
      ...bucketLabels(data.baseLoad.perMonth ? 'year' : 'month', `${d.dateKey}T12:00:00Z`),
      value: d.watts,
    })),
  );
  const pct = new Intl.NumberFormat('de-AT', { signDisplay: 'exceptZero', maximumFractionDigits: 0 });
</script>

<svelte:head><title>Strom · Home</title></svelte:head>

<div class="stack">
  <header class="head">
    <h1>Strom</h1>
    <nav class="views" aria-label="Zeitraum">
      {#each Object.entries(VIEW_LABELS) as [view, text] (view)}
        <a
          href={resolve('/strom/[view]/[date]', { view: view as View, date: data.period.key })}
          aria-current={data.view === view ? 'page' : undefined}
          data-sveltekit-noscroll
        >
          {text}
        </a>
      {/each}
    </nav>
    <div class="pager">
      <a
        class="arrow"
        href={resolve('/strom/[view]/[date]', { view: data.view, date: data.prevKey })}
        aria-label="Vorheriger Zeitraum"
        data-sveltekit-noscroll
      >
        ‹
      </a>
      <h2 data-testid="period-label">{periodLabel(data.view, data.period.start, data.period.end)}</h2>
      {#if data.nextKey}
        <a
          class="arrow"
          href={resolve('/strom/[view]/[date]', { view: data.view, date: data.nextKey })}
          aria-label="Nächster Zeitraum"
          data-sveltekit-noscroll
        >
          ›
        </a>
      {:else}
        <span class="arrow disabled" aria-hidden="true">›</span>
      {/if}
    </div>
  </header>

  {#if !hasData}
    <section class="card stack">
      <h2>Keine Daten in diesem Zeitraum</h2>
      <p class="muted">
        {data.dataEnd
          ? `Daten liegen bis ${formatDateTime(data.dataEnd)} vor.`
          : 'Noch keine Messwerte vorhanden. Zuerst den NetzOÖ-Export importieren.'}
      </p>
    </section>
  {:else}
    <section class="grid" aria-label="Kennzahlen">
      <article class="card tile">
        <span class="label">Bezug</span>
        <span class="value" data-testid="stat-total">{kwhFormat.format(data.stats.totalKwh)} kWh</span>
      </article>
      {#if data.stats.avgPerDayKwh !== null}
        <article class="card tile">
          <span class="label">Ø pro Tag</span>
          <span class="value">{kwhFormat.format(data.stats.avgPerDayKwh)} kWh</span>
        </article>
      {/if}
      {#if data.stats.peakKw !== null && data.stats.peakAt}
        <article class="card tile">
          <span class="label">Spitze (15 min)</span>
          <span class="value">{kwFormat.format(data.stats.peakKw)} kW</span>
          <span class="hint muted">
            {data.view === 'day' ? formatTime(data.stats.peakAt) : formatDateTime(data.stats.peakAt)}
          </span>
        </article>
      {/if}
      {#if data.baseLoad.medianW !== null}
        <article class="card tile">
          <span class="label">Grundlast</span>
          <span class="value">{intFormat.format(data.baseLoad.medianW)} W</span>
          <span class="hint muted">≈ {intFormat.format(data.baseLoad.medianW * 8.76)} kWh/Jahr</span>
        </article>
      {/if}
    </section>

    <section class="card stack" aria-labelledby="profile-heading">
      <h2 id="profile-heading">
        {data.view === 'day' ? 'Lastprofil (Ø-Leistung je Viertelstunde)' : 'Verbrauch'}
      </h2>
      <BarChart
        {bars}
        unit={chartUnit}
        format={(v) => (data.view === 'day' ? kwFormat.format(v) : kwhFormat.format(v))}
        label={data.view === 'day' ? 'Leistung je Viertelstunde' : 'Verbrauch je Zeitabschnitt'}
        {axisEvery}
        testid="profile-chart"
      />
      {#if data.stats.derived > 0}
        <p class="muted small">
          {intFormat.format(data.stats.derived)} Viertelstunden stammen vom AMIS-Leser, bis der NetzOÖ-Export sie
          ersetzt.
        </p>
      {/if}
    </section>

    <section class="card stack" aria-labelledby="compare-heading">
      <h2 id="compare-heading">Vergleich</h2>
      <ul class="compare">
        {#each data.comparisons as c (c.label)}
          <li>
            <span>{c.label}{c.partial ? ' (gleich langer Zeitraum)' : ''}</span>
            <span class="num">
              {#if c.changePct !== null}
                {kwhFormat.format(c.previousKwh)} kWh
                <strong class="change">{pct.format(c.changePct)} %</strong>
              {:else}
                <span class="muted">keine Daten</span>
              {/if}
            </span>
          </li>
        {/each}
      </ul>
    </section>

    {#if data.view !== 'day' && baseLoadBars.length > 1}
      <section class="card stack" aria-labelledby="base-heading">
        <h2 id="base-heading">Grundlast je {data.baseLoad.perMonth ? 'Monat' : 'Tag'}</h2>
        <p class="muted small">
          Niedrigste Viertelstunden-Leistung des Tages – Geräte im Dauerbetrieb{data.baseLoad.perMonth
            ? ', je Monat der Median'
            : ''}.
        </p>
        <BarChart
          bars={baseLoadBars}
          unit="W"
          format={(v) => intFormat.format(v)}
          label="Grundlast"
          axisEvery={Math.max(1, Math.ceil(baseLoadBars.length / 7))}
          height={150}
        />
      </section>
    {/if}

    {#if data.heatmap}
      <section class="card stack" aria-labelledby="heat-heading">
        <h2 id="heat-heading">Wann wird Strom gebraucht?</h2>
        <p class="muted small">Ø-Leistung je Wochentag und Stunde.</p>
        <Heatmap
          values={data.heatmap}
          unit="kW"
          format={(v) => kwFormat.format(v)}
          label="Durchschnittliche Leistung je Wochentag und Stunde"
        />
      </section>
    {/if}
  {/if}

  <section class="card row-between">
    <span class="muted small">
      {data.dataEnd ? `Daten bis ${formatDateTime(data.dataEnd)}` : 'Noch keine Daten'}
    </span>
    <a href={resolve('/strom/import')}>NetzOÖ-Export importieren</a>
  </section>
</div>

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .views {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    background: var(--surface-2);
    border-radius: 12px;
    padding: 4px;
    gap: 4px;
  }

  .views a {
    text-align: center;
    padding: 8px 0;
    border-radius: 9px;
    color: var(--text);
    text-decoration: none;
    font-weight: 500;
  }

  .views a[aria-current='page'] {
    background: var(--surface);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
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
    font-size: 1.4rem;
    font-weight: 700;
  }

  .hint,
  .small {
    font-size: 0.8rem;
  }

  .compare {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .compare li {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }

  .num {
    font-variant-numeric: tabular-nums;
  }

  .change {
    margin-left: 8px;
  }

  .row-between {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
</style>
