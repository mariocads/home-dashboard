<script lang="ts">
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import type { SubmitFunction } from '$app/forms';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let busy = $state<'preview' | 'import' | null>(null);
  /** Datei nach der Vorschau gewechselt: Vorschau gilt nicht mehr. */
  let fileChanged = $state(false);

  const dateTime = new Intl.DateTimeFormat('de-AT', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Vienna',
  });
  const date = new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium', timeZone: 'Europe/Vienna' });
  const num = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 1 });
  const int = new Intl.NumberFormat('de-AT');
  const fmtDateTime = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : '–');
  /** Zeitraum als Tage; das Ende ist exklusiv, daher zählt der Tag davor. */
  const fmtRange = (from: string | null, to: string | null) => {
    if (!from || !to) return '–';
    const first = date.format(new Date(from));
    const last = date.format(new Date(new Date(to).getTime() - 1));
    return first === last ? first : `${first} – ${last}`;
  };

  const preview = $derived(form && 'preview' in form && !fileChanged ? form.preview : null);
  const changes = $derived(preview ? preview.inserted + preview.updated : 0);
  const otherStatus = $derived(
    preview ? Object.entries(preview.statusCounts).filter(([status]) => status !== 'VALID') : [],
  );

  const submit: SubmitFunction = ({ action }) => {
    busy = action.search.includes('import') ? 'import' : 'preview';
    return async ({ update, result }) => {
      await update({ reset: result.type === 'success' && busy === 'import' });
      if (result.type === 'success') fileChanged = false;
      busy = null;
    };
  };
</script>

<svelte:head><title>Daten importieren · Home</title></svelte:head>

<div class="stack">
  <header>
    <a class="back" href={resolve('/strom')}>← Strom</a>
    <h1>Daten importieren</h1>
  </header>

  <section class="card stack">
    <h2>NetzOÖ-Export</h2>
    <p class="muted small">
      Im Smartmeter-Portal von NetzOÖ die Viertelstundenwerte als CSV exportieren und hier hochladen. Bereits
      vorhandene Werte werden erkannt, geänderte (z. B. Ersatzwerte) überschrieben.
    </p>
    <form method="POST" enctype="multipart/form-data" use:enhance={submit} class="stack">
      <label for="csv">CSV-Datei</label>
      <input
        id="csv"
        name="file"
        type="file"
        accept=".csv,text/csv"
        required
        onchange={() => (fileChanged = true)}
      />
      <div class="row">
        <button class="secondary" type="submit" formaction="?/preview" disabled={busy !== null}>
          {busy === 'preview' ? 'Prüfe…' : 'Prüfen'}
        </button>
        <button
          type="submit"
          formaction="?/import"
          disabled={busy !== null || !preview || changes === 0}
          data-testid="import-submit"
        >
          {busy === 'import' ? 'Importiere…' : 'Importieren'}
        </button>
      </div>
    </form>
    {#if form && 'error' in form && form.error}<p class="error" role="alert">{form.error}</p>{/if}
    {#if form && 'imported' in form && form.imported}
      <p class="ok" role="status">
        Import abgeschlossen: {int.format(form.imported.inserted)} neu, {int.format(form.imported.updated)} aktualisiert,
        {int.format(form.imported.unchanged)} unverändert.
      </p>
    {/if}
  </section>

  {#if preview}
    <section class="card stack" data-testid="import-preview" aria-label="Vorschau">
      <h2>Vorschau</h2>
      {#if preview.alreadyImportedAt}
        <p class="warn-text">
          Diese Datei wurde bereits am {fmtDateTime(preview.alreadyImportedAt)} importiert.
        </p>
      {/if}
      <dl class="facts">
        <dt>Zeitraum</dt>
        <dd>{fmtRange(preview.from, preview.to)}</dd>
        <dt>Viertelstunden</dt>
        <dd>{int.format(preview.count)}</dd>
        <dt>Bezug gesamt</dt>
        <dd>{num.format(preview.totalKwh)} kWh</dd>
        <dt>Neu</dt>
        <dd data-testid="preview-inserted">{int.format(preview.inserted)}</dd>
        <dt>Geändert</dt>
        <dd>{int.format(preview.updated)}</dd>
        {#if preview.replacesAmis}
          <dt>davon AMIS-Werte</dt>
          <dd data-testid="preview-replaces-amis">{int.format(preview.replacesAmis)}</dd>
        {/if}
        <dt>Schon vorhanden</dt>
        <dd>{int.format(preview.unchanged)}</dd>
      </dl>
      {#if changes === 0}
        <p class="muted small">Nichts Neues – alle Werte sind bereits gespeichert.</p>
      {/if}

      {#if otherStatus.length}
        <p class="muted small">
          Nicht als gültig markiert: {otherStatus.map(([s, n]) => `${int.format(n)} × ${s}`).join(', ')}
        </p>
      {/if}

      {#if preview.gapCount}
        <h3>Lücken ({preview.gapCount}, {int.format(preview.missingIntervals)} Viertelstunden)</h3>
        <ul class="plain small">
          {#each preview.gaps as gap (gap.from)}
            <li>{fmtDateTime(gap.from)} – {fmtDateTime(gap.to)} ({gap.missing} fehlen)</li>
          {/each}
          {#if preview.gapCount > preview.gaps.length}<li class="muted">…</li>{/if}
        </ul>
      {:else}
        <p class="muted small">Keine Lücken im Zeitraum.</p>
      {/if}

      {#if preview.issueCount}
        <h3>Übersprungene Zeilen ({preview.issueCount})</h3>
        <ul class="plain small">
          {#each preview.issues as issue (issue.line)}
            <li>Zeile {issue.line}: {issue.message}</li>
          {/each}
          {#if preview.issueCount > preview.issues.length}<li class="muted">…</li>{/if}
        </ul>
      {/if}
    </section>
  {/if}

  <section class="card stack" aria-labelledby="log-heading">
    <h2 id="log-heading">Protokoll</h2>
    {#if data.imports.length === 0}
      <p class="muted">Noch keine Importe.</p>
    {:else}
      <ul class="plain log" data-testid="import-log">
        {#each data.imports as entry (entry.id)}
          <li>
            <strong>{fmtDateTime(entry.createdAt)}</strong>
            <div class="muted small">
              {fmtRange(entry.from, entry.to)} · {int.format(entry.rowCount)} Werte · {int.format(
                entry.inserted,
              )} neu · {int.format(entry.updated)} aktualisiert{#if entry.gapCount}
                · {entry.gapCount} Lücken{/if}{#if entry.issueCount}
                · {entry.issueCount} übersprungen{/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .back {
    font-size: 0.9rem;
  }

  .row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .small {
    font-size: 0.85rem;
  }

  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 16px;
    margin: 0;
  }

  .facts dt {
    color: var(--text-muted);
  }

  .facts dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .plain {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .log li {
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--surface-2);
  }

  h3 {
    font-size: 1rem;
    margin: 0;
  }

  .ok {
    color: var(--accent);
  }

  .warn-text {
    color: var(--energy);
  }
</style>
