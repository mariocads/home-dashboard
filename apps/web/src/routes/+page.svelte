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
    <article class="card tile">
      <span class="label">Leistung jetzt</span>
      <span class="value">–</span>
      <span class="hint muted">ab Phase 1b (AMIS-Leser)</span>
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

  <section class="card">
    <h2>Fundament steht</h2>
    <p class="muted">
      Login, Datenbank und Deployment sind eingerichtet. Als Nächstes kommt der Import der Smartmeter-Daten.
    </p>
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

  .hint {
    font-size: 0.75rem;
    margin-top: auto;
  }
</style>
