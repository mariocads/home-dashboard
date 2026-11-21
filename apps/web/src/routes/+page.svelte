<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { formatDay, formatEur, formatKwh, formatMonth, formatTime, priceFormat } from '#lib/format.ts';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const kw = new Intl.NumberFormat('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const time = new Intl.DateTimeFormat('de-AT', { timeStyle: 'short', timeZone: 'Europe/Vienna' });

  // Neue Werte kommen höchstens im Abfrageintervall (Standard 60 s); alle 30 s nachladen reicht.
  $effect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void invalidateAll();
    }, 30_000);
    return () => clearInterval(id);
  });
</script>

<svelte:head><title>Übersicht · Home</title></svelte:head>

<div class="stack">
  <header>
    <h1>Übersicht</h1>
    <p class="muted">Energie &amp; Kosten auf einen Blick</p>
  </header>

  {#if data.todos.length > 0}
    <section class="stack todos" aria-label="Zu erledigen">
      {#each data.todos as todo (todo.quarter)}
        <a
          class="card todo link"
          class:action={todo.status === 'review' || todo.status === 'failed'}
          href={resolve('/ladeaufstellung/[quartal]', { quartal: todo.quarter })}
          data-testid="todo-charge-report"
        >
          <span class="todo-title">Lade-Aufstellung {todo.label}</span>
          <span class="muted todo-status">{todo.statusLabel}</span>
        </a>
      {/each}
    </section>
  {/if}

  <section class="grid" aria-label="Kennzahlen">
    <a class="card tile link" href={resolve('/strom')} data-testid="tile-day">
      {#if data.overview}
        <span class="label">
          {data.overview.isToday ? 'Strom heute' : `Strom ${formatDay(data.overview.dayKey + 'T12:00:00Z')}`}
        </span>
        <span class="value">{formatKwh(data.overview.dayKwh)} kWh</span>
        <span class="hint muted">
          {data.overview.dayComplete ? 'ganzer Tag' : `bis ${formatTime(data.overview.dataEnd)}`}
        </span>
      {:else}
        <span class="label">Strom heute</span>
        <span class="value">–</span>
        <span class="hint muted">NetzOÖ-Export importieren</span>
      {/if}
    </a>
    <article class="card tile" data-testid="tile-power">
      <span class="label">Leistung jetzt</span>
      {#if data.power}
        <span class="value" class:stale={data.power.stale}>{kw.format(data.power.watt / 1000)} kW</span>
        <span class="hint muted">
          {data.power.stale ? 'veraltet · ' : ''}Stand {time.format(new Date(data.power.ts))}
        </span>
      {:else}
        <span class="value">–</span>
        <span class="hint muted">noch keine Daten vom AMIS-Leser</span>
      {/if}
    </article>
    <a
      class="card tile link"
      href={data.overview
        ? resolve('/strom/[view]/[date]', { view: 'month', date: data.overview.monthKey })
        : resolve('/strom')}
      data-testid="tile-month"
    >
      <span class="label">
        {data.overview ? formatMonth(data.overview.monthKey + 'T12:00:00Z') : 'Monat'} bisher
      </span>
      <span class="value">{data.overview ? `${formatKwh(data.overview.monthKwh)} kWh` : '–'}</span>
      <span class="hint muted">
        {data.overview?.forecastKwh != null
          ? `Prognose ${formatKwh(data.overview.forecastKwh)} kWh`
          : 'Prognose ab einem vollen Tag'}
      </span>
    </a>
    <a class="card tile link" href={resolve('/kosten')} data-testid="tile-cost">
      {#if data.cost}
        <span class="label">
          Kosten {formatMonth(data.cost.monthKey + 'T12:00:00Z')}{data.cost.complete ? '' : ' bisher'}
        </span>
        <span class="value">{formatEur(data.cost.gross)}</span>
        <span class="hint muted">
          {data.cost.ctPerKwh !== null ? `Ø ${priceFormat.format(data.cost.ctPerKwh)} ct/kWh` : 'brutto'}
        </span>
      {:else}
        <span class="label">Kosten Monat</span>
        <span class="value">–</span>
        <span class="hint muted">Tarife erfassen</span>
      {/if}
    </a>
    <a class="card tile link" href={resolve('/waermepumpe')} data-testid="tile-heatpump">
      <span class="label">Wärmepumpe heute</span>
      {#if data.heatPump}
        <span class="value" class:stale={data.heatPump.stale}>
          {data.heatPump.powerKwh !== null ? `${formatKwh(data.heatPump.powerKwh)} kWh` : '–'}
        </span>
        <span class="hint muted">
          {data.heatPump.stale
            ? 'veraltet'
            : data.heatPump.inverterW
              ? `läuft · ${kw.format(data.heatPump.inverterW / 1000)} kW`
              : 'Verdichter aus'}{data.heatPump.ratio !== null
            ? ` · AZ ${kw.format(data.heatPump.ratio)}`
            : ''}
        </span>
      {:else}
        <span class="value">–</span>
        <span class="hint muted">noch keine Daten von der ISG</span>
      {/if}
    </a>
  </section>
</div>

<style>
  .tile {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 112px;
  }

  .link {
    color: inherit;
    text-decoration: none;
  }

  .label {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .value {
    font-size: 1.6rem;
    white-space: nowrap;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .value.stale {
    color: var(--text-muted);
  }

  .hint {
    font-size: 0.75rem;
    margin-top: auto;
  }

  .todos {
    gap: 8px;
  }

  .todo {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border-left: 4px solid var(--border);
  }

  .todo.action {
    border-left-color: var(--energy);
  }

  .todo-title {
    font-weight: 600;
  }

  .todo-status {
    font-size: 0.85rem;
    text-align: right;
  }
</style>
