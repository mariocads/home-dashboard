<script lang="ts">
  import { invalidateAll } from '$app/navigation';
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

  <section class="grid" aria-label="Kennzahlen">
    <article class="card tile">
      <span class="label">Strom heute</span>
      <span class="value">–</span>
      <span class="hint muted">ab Phase 1 (NetzOÖ-Import)</span>
    </article>
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
    <article class="card tile">
      <span class="label">Kosten Monat</span>
      <span class="value">–</span>
      <span class="hint muted">ab Phase 1 (Tarife)</span>
    </article>
    <article class="card tile">
      <span class="label">Wärmepumpe</span>
      <span class="value">–</span>
      <span class="hint muted">ab Phase 3 (ISG)</span>
    </article>
  </section>
</div>

<style>
  .tile {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 112px;
  }

  .label {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .value {
    font-size: 1.75rem;
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
</style>
