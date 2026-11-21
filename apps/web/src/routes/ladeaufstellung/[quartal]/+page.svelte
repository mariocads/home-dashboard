<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const r = $derived(data.report);

  const kwh = new Intl.NumberFormat('de-AT', { minimumFractionDigits: 1, maximumFractionDigits: 3 });
  const dateTime = new Intl.DateTimeFormat('de-AT', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Vienna',
  });
  const dateLong = new Intl.DateTimeFormat('de-AT', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Vienna',
  });
  const fmt = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : '–');

  // Solange der Collector arbeitet, alle 5 s nachladen
  const busy = $derived(
    r.status === 'requested' || r.status === 'approved' || r.refreshPending || r.testPending,
  );
  $effect(() => {
    if (!busy) return;
    const id = setInterval(() => void invalidateAll(), 5000);
    return () => clearInterval(id);
  });

  const reviewable = $derived(r.status === 'review' || r.status === 'failed');
  const canSend = $derived(
    reviewable && r.hasCsv && !r.parseError && !!r.mail.to && r.mailStatus.state === 'ready',
  );
  const gap = $derived(r.summary.unaccountedKwh !== null && Math.abs(r.summary.unaccountedKwh) > 0.5);
</script>

<svelte:head><title>Lade-Aufstellung {r.label} · Home</title></svelte:head>

<div class="stack">
  <a class="back" href={resolve('/ladeaufstellung')}>← Alle Aufstellungen</a>
  <header>
    <h1>Lade-Aufstellung {r.label}</h1>
    <p class="muted">
      {r.period} · <span class="status {r.status}" data-testid="report-status">{r.statusLabel}</span>
    </p>
  </header>

  {#if form && 'error' in form && form.error}<p class="card alert" role="alert">{form.error}</p>{/if}
  {#if r.lastError}
    <p class="card alert" role="alert" data-testid="report-error">
      <strong>Fehler:</strong> <code>{r.lastError}</code>
    </p>
  {/if}

  {#if r.status === 'requested'}
    <section class="card stack">
      <p>
        Der Collector holt den Export aus der go-e-Cloud, sobald kein Auto mehr angesteckt ist (spätestens
        drei Tage nach Quartalsende).
      </p>
      <form method="POST" action="?/refresh" use:enhance>
        <button class="secondary" type="submit" disabled={r.refreshPending}>
          {r.refreshPending ? 'Wird geholt…' : 'Jetzt holen'}
        </button>
      </form>
    </section>
  {/if}

  {#if r.status === 'approved'}
    <p class="card" role="status">Freigegeben. Die Mail wird in den nächsten Sekunden verschickt…</p>
  {:else if r.status === 'sent' && r.sentAt}
    <p class="card ok" role="status" data-testid="report-sent">
      Gesendet am {dateLong.format(new Date(r.sentAt))} an {r.sentTo}.
    </p>
  {:else if r.status === 'skipped'}
    <section class="card stack">
      <p>Dieses Quartal wird nicht eingereicht.</p>
      <form method="POST" action="?/reopen" use:enhance>
        <button class="secondary" type="submit">Wieder öffnen</button>
      </form>
    </section>
  {/if}

  {#if r.hasCsv}
    <section class="grid" aria-label="Summen">
      <article class="card tile">
        <span class="label">Ladungen</span>
        <span class="value" data-testid="report-count">{r.summary.count}</span>
      </article>
      <article class="card tile">
        <span class="label">Energie</span>
        <span class="value" data-testid="report-kwh">{kwh.format(r.summary.energyKwh)} kWh</span>
      </article>
      <article class="card tile">
        <span class="label">Zählerstand</span>
        <span class="value small-value">
          {r.summary.counterStartKwh !== null ? kwh.format(r.summary.counterStartKwh) : '–'} →
          {r.summary.counterEndKwh !== null ? kwh.format(r.summary.counterEndKwh) : '–'}
        </span>
        <span class="hint muted">
          {r.summary.unaccountedKwh === null
            ? 'keine Zählerstände'
            : gap
              ? `${kwh.format(r.summary.unaccountedKwh)} kWh ohne Ladung`
              : 'deckt sich mit den Ladungen'}
        </span>
      </article>
      {#if r.own}
        <article class="card tile">
          <span class="label">Eigene Messung</span>
          <span class="value small-value">{kwh.format(r.own.kwh)} kWh</span>
          <span class="hint muted">
            {r.own.complete ? 'ganzes Quartal' : `erst ab ${fmt(r.own.from)}, kein Vergleich`}
          </span>
        </article>
      {/if}
    </section>

    {#if r.parseError}<p class="card alert" role="alert">Export nicht lesbar: {r.parseError}</p>{/if}
    {#if r.summary.open.length > 0}
      <p class="card alert" role="alert">
        Ladung {r.summary.open.join(', ')} lief beim Export noch. Nach dem Abstecken „Neu laden“.
      </p>
    {/if}
    {#if gap}
      <p class="card alert" role="alert">
        Zwischen den Ladungen fehlen {kwh.format(r.summary.unaccountedKwh ?? 0)} kWh. Fehlt eine Ladung im Export?
      </p>
    {/if}

    <section class="card">
      <h2>Ladungen</h2>
      {#if r.sessions.length === 0}
        <p class="muted">Keine Ladungen in diesem Quartal.</p>
      {:else}
        <div class="scroll">
          <table data-testid="report-sessions">
            <thead>
              <tr><th>Nr.</th><th>Start</th><th>Ende</th><th>Dauer</th><th class="num">kWh</th></tr>
            </thead>
            <tbody>
              {#each r.sessions as s (s.number)}
                <tr>
                  <td>{s.number}</td>
                  <td>{fmt(s.start)}</td>
                  <td>{fmt(s.end)}</td>
                  <td>{s.duration}</td>
                  <td class="num">{kwh.format(s.energyKwh)}</td>
                </tr>
              {/each}
            </tbody>
            <tfoot>
              <tr><td colspan="4">Summe</td><td class="num">{kwh.format(r.summary.energyKwh)}</td></tr>
            </tfoot>
          </table>
        </div>
      {/if}
      <p class="small muted">
        Export vom {r.fetchedAt ? dateLong.format(new Date(r.fetchedAt)) : '–'} ·
        <a href={resolve('/ladeaufstellung/[quartal]/csv', { quartal: r.quarter })} data-sveltekit-reload>
          CSV herunterladen
        </a>
      </p>
    </section>

    {#if r.status !== 'sent'}
      <section class="card stack" aria-label="Mail">
        <h2>Mail</h2>
        <dl class="facts small">
          <dt>Von</dt>
          <dd>{r.mailStatus.target ?? '–'}</dd>
          <dt>An</dt>
          <dd data-testid="mail-to">{r.mail.to || 'kein Empfänger eingetragen'}</dd>
          <dt>Betreff</dt>
          <dd>{r.mail.subject}</dd>
          <dt>Anhang</dt>
          <dd>{r.mail.filename}</dd>
        </dl>
        <pre class="body small">{r.mail.body}</pre>
        {#if r.mailStatus.hint}<p class="small error">Mailversand: {r.mailStatus.hint}</p>{/if}
        {#if !r.mail.to}
          <p class="small error">
            Empfänger fehlt: in den <a href={resolve('/einstellungen')}>Einstellungen</a> unter Lade-Aufstellung
            eintragen.
          </p>
        {/if}
        {#if r.testSentAt && !r.testPending}
          <p class="small muted" role="status">
            Testmail verschickt am {dateLong.format(new Date(r.testSentAt))}.
          </p>
        {/if}

        {#if reviewable}
          <form method="POST" action="?/approve" use:enhance>
            <input type="hidden" name="sha256" value={r.csvSha256} />
            <button type="submit" disabled={!canSend} data-testid="approve">Freigeben und senden</button>
          </form>
          <div class="actions">
            <form method="POST" action="?/test" use:enhance>
              <button
                class="secondary"
                type="submit"
                disabled={r.testPending || r.mailStatus.state !== 'ready'}
              >
                {r.testPending ? 'Testmail wird gesendet…' : 'Testmail an mich'}
              </button>
            </form>
            <form method="POST" action="?/refresh" use:enhance>
              <button class="secondary" type="submit" disabled={r.refreshPending}>
                {r.refreshPending ? 'Wird neu geladen…' : 'Neu laden'}
              </button>
            </form>
            <form method="POST" action="?/skip" use:enhance>
              <button class="secondary" type="submit">Überspringen</button>
            </form>
          </div>
        {/if}
      </section>
    {/if}
  {/if}
</div>

<style>
  .back {
    font-size: 0.9rem;
    text-decoration: none;
  }

  header h1 {
    margin-bottom: 4px;
  }

  .status {
    font-weight: 600;
  }

  .status.review,
  .status.failed {
    color: var(--danger);
  }

  .status.sent {
    color: var(--ok);
  }

  .alert {
    border-color: var(--danger);
  }

  .ok {
    border-color: var(--ok);
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
    font-size: 1.6rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .small-value {
    font-size: 1.1rem;
  }

  .hint {
    font-size: 0.75rem;
  }

  .scroll {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }

  th,
  td {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }

  th {
    color: var(--text-muted);
    font-weight: 600;
  }

  tfoot td {
    font-weight: 700;
    border-bottom: none;
  }

  .num {
    text-align: right;
  }

  .small {
    font-size: 0.8rem;
  }

  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 12px;
    margin: 0;
  }

  .facts dt {
    color: var(--text-muted);
  }

  .facts dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .body {
    margin: 0;
    padding: 12px;
    border-radius: 10px;
    background: var(--surface-2);
    white-space: pre-wrap;
    font-family: inherit;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
