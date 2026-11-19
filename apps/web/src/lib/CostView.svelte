<script lang="ts">
  import { resolve } from '$app/paths';
  import BarChart, { type Bar } from '#lib/charts/BarChart.svelte';
  import {
    bucketLabels,
    eurFormat,
    formatDateKey,
    formatDateTime,
    formatDay,
    formatEur,
    formatMonth,
    intFormat,
    kwhFormat,
    pctFormat,
    priceFormat,
  } from '#lib/format.ts';
  import type { CostsView } from '#lib/server/costs.ts';

  let { data }: { data: CostsView } = $props();

  const s = $derived(data.selected);
  const bars = $derived<Bar[]>(
    data.months.map((m) => ({
      ...bucketLabels('year', m.start),
      value: m.gross ?? 0,
      incomplete: m.gross !== null && !m.complete,
    })),
  );
  const lastDay = (iso: string) => formatDay(new Date(new Date(iso).getTime() - 1).toISOString());

  function quantity(l: {
    unit: string;
    quantity: number;
    component: { priceGross: number; unitLabel: string };
  }) {
    const price = `${priceFormat.format(l.component.priceGross)} ${l.component.unitLabel}`;
    return l.unit === 'ct_kwh'
      ? `${kwhFormat.format(l.quantity)} kWh × ${price}`
      : `${intFormat.format(l.quantity)} ${l.quantity === 1 ? 'Tag' : 'Tage'} · ${price}`;
  }
</script>

<svelte:head><title>Kosten · Home</title></svelte:head>

<div class="stack">
  <header class="head">
    <h1>Kosten</h1>
    <div class="pager">
      <a
        class="arrow"
        href={resolve('/kosten/[month]', { month: data.prevKey })}
        aria-label="Vorheriger Monat"
        data-sveltekit-noscroll
      >
        ‹
      </a>
      <h2 data-testid="cost-month">{formatMonth(data.month.start)}</h2>
      {#if data.nextKey}
        <a
          class="arrow"
          href={resolve('/kosten/[month]', { month: data.nextKey })}
          aria-label="Nächster Monat"
          data-sveltekit-noscroll
        >
          ›
        </a>
      {:else}
        <span class="arrow disabled" aria-hidden="true">›</span>
      {/if}
    </div>
  </header>

  {#if !data.hasTariffs}
    <section class="card stack">
      <h2>Noch keine Tarife</h2>
      <p class="muted">
        Für die Kostenberechnung braucht es die Preise von Lieferant und Netzbetreiber. Sie lassen sich
        einzeln erfassen oder aus einer lokalen JSON-Datei übernehmen.
      </p>
      <a class="button" href={resolve('/kosten/tarife')}>Tarife erfassen</a>
    </section>
  {:else if !s}
    <section class="card stack">
      <h2>Keine Messwerte in diesem Monat</h2>
      <p class="muted">
        {data.dataEnd
          ? `Daten liegen bis ${formatDateTime(data.dataEnd)} vor.`
          : 'Noch keine Messwerte vorhanden.'}
      </p>
    </section>
  {:else}
    <section class="grid" aria-label="Kennzahlen">
      <article class="card tile">
        <span class="label">Kosten {s.complete ? '' : 'bisher'}</span>
        <span class="value" data-testid="cost-total">{formatEur(s.gross)}</span>
        {#if !s.complete}
          <span class="hint muted">{formatDay(s.from)} – {lastDay(s.to)}</span>
        {/if}
      </article>
      {#if s.ctPerKwh !== null}
        <article class="card tile">
          <span class="label">Ø Preis</span>
          <span class="value">{priceFormat.format(s.ctPerKwh)} ct</span>
          <span class="hint muted">je kWh, alles inklusive</span>
        </article>
      {/if}
      <article class="card tile">
        <span class="label">Verbrauch</span>
        <span class="value">{kwhFormat.format(s.kwh)} kWh</span>
      </article>
      <article class="card tile">
        <span class="label">Teilzahlungen</span>
        <span class="value">{formatEur(s.paid)}</span>
        <span class="hint muted">fällig in diesem Monat</span>
      </article>
    </section>

    <section class="card stack" aria-labelledby="parts-heading">
      <h2 id="parts-heading">Zusammensetzung</h2>
      {#each s.groups as g (g.category)}
        <div class="group">
          <h3 class="row-between">
            <span>{g.label}</span>
            <span class="num" data-testid="cost-{g.category}">{eurFormat.format(g.gross)}</span>
          </h3>
          <ul class="lines">
            {#each g.lines as l (l.index)}
              <li>
                <div>
                  <span>{l.name}</span>
                  <span class="muted small">
                    {l.payee} · {quantity(l)}{l.component.windowLabel ? ` · ${l.component.windowLabel}` : ''}
                  </span>
                </div>
                <span class="num">{eurFormat.format(l.gross)}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
      <dl class="sum">
        <dt>Netto</dt>
        <dd class="num">{eurFormat.format(s.net)}</dd>
        <dt>USt</dt>
        <dd class="num">{eurFormat.format(s.gross - s.net)}</dd>
        <dt><strong>Brutto</strong></dt>
        <dd class="num"><strong>{eurFormat.format(s.gross)}</strong></dd>
      </dl>
      <p class="muted small">
        Arbeitspreise je Viertelstunde, Pauschalen anteilig je Tag mit Messwerten. Brutto je Zeile auf Cent
        gerundet.
      </p>
    </section>
  {/if}

  {#if data.hasTariffs}
    <section class="card stack" aria-labelledby="year-heading">
      <h2 id="year-heading">Kosten {data.year}</h2>
      <BarChart
        {bars}
        unit="€"
        format={(v) => intFormat.format(v)}
        label="Kosten brutto je Monat"
        testid="cost-chart"
      />
    </section>

    <section class="card stack" aria-labelledby="balance-heading">
      <h2 id="balance-heading">Teilzahlungen und Berechnung {data.year}</h2>
      {#if data.balances.length}
        <ul class="lines" data-testid="balance-list">
          {#each data.balances as b (b.payee)}
            <li>
              <div>
                <span>{b.payee}</span>
                <span class="muted small">
                  {b.months}
                  {b.months === 1 ? 'Monat' : 'Monate'} · bezahlt {eurFormat.format(b.paid)} · berechnet
                  {eurFormat.format(b.computed)}
                </span>
              </div>
              <div class="num balance">
                <strong>{eurFormat.format(b.balance)}</strong>
                <span class="muted small">{b.balance >= 0 ? 'Guthaben' : 'Nachzahlung'}</span>
              </div>
            </li>
          {/each}
        </ul>
        <p class="muted small">
          Nur vollständige Monate mit Messwerten. Ein positiver Saldo deutet auf ein Guthaben in der
          Jahresabrechnung hin.
        </p>
      {:else}
        <p class="muted">Noch kein vollständiger Monat mit Teilzahlungen und Messwerten.</p>
      {/if}
    </section>

    <section class="card stack" aria-labelledby="invoice-heading">
      <h2 id="invoice-heading">Rechnungsabgleich</h2>
      {#if data.invoices.length}
        <ul class="lines" data-testid="invoice-list">
          {#each data.invoices as inv (inv.id)}
            <li>
              <div>
                <span>{inv.payee} · {formatDateKey(inv.fromDate)} – {formatDateKey(inv.toDate)}</span>
                <span class="muted small">
                  Rechnung {eurFormat.format(inv.amountGross)} · berechnet {eurFormat.format(inv.computed)}
                  {#if inv.coveragePct < 100}· Messwerte für {inv.coveragePct} % des Zeitraums{/if}
                </span>
              </div>
              <strong class="num">
                {inv.deviationPct === null ? '–' : `${pctFormat.format(inv.deviationPct)} %`}
              </strong>
            </li>
          {/each}
        </ul>
        <p class="muted small">Abweichung der Berechnung von der Rechnung (positiv = Berechnung höher).</p>
      {:else}
        <p class="muted">Noch keine Rechnung erfasst. Rechnungen werden unter Tarife eingetragen.</p>
      {/if}
    </section>
  {/if}

  <section class="card row-between">
    <span class="muted small">
      {data.dataEnd ? `Daten bis ${formatDateTime(data.dataEnd)}` : 'Noch keine Daten'}
    </span>
    <a href={resolve('/kosten/tarife')}>Tarife verwalten</a>
  </section>
</div>

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: 12px;
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
    white-space: nowrap;
  }

  .hint,
  .small {
    font-size: 0.8rem;
  }

  h3 {
    font-size: 0.95rem;
    margin: 0 0 6px;
  }

  .group + .group {
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }

  .lines {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .lines li {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }

  .lines li > div {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .num {
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
  }

  .sum {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4px 12px;
    margin: 0;
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }

  .sum dd {
    margin: 0;
  }

  .row-between {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .lines li > .balance {
    flex-direction: column;
    align-items: flex-end;
  }

  .button {
    align-self: flex-start;
  }
</style>
