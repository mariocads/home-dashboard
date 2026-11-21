<script lang="ts">
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import { formatKwh } from '#lib/format.ts';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const date = new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium', timeZone: 'Europe/Vienna' });
</script>

<svelte:head><title>Lade-Aufstellung · Home</title></svelte:head>

<div class="stack">
  <header>
    <h1>Lade-Aufstellung</h1>
    <p class="muted">Ladungen der Wallbox je Quartal, als CSV aus der go-e-Cloud</p>
  </header>

  {#if data.mailStatus.state !== 'ready'}
    <p class="card note small" data-testid="mail-status">Mailversand: {data.mailStatus.hint}</p>
  {/if}

  <section class="card stack">
    {#if data.reports.length === 0}
      <p class="muted">Noch keine Aufstellung. Zum Quartalsende legt die App automatisch eine an.</p>
    {:else}
      <ul class="list" data-testid="report-list">
        {#each data.reports as r (r.quarter)}
          <li>
            <a href={resolve('/ladeaufstellung/[quartal]', { quartal: r.quarter })}>
              <strong>{r.label}</strong>
              <span class="muted small">
                {r.sessionCount !== null
                  ? `${r.sessionCount} Ladungen · ${formatKwh(r.energyKwh ?? 0)} kWh`
                  : 'noch kein Export'}{r.sentAt ? ` · gesendet am ${date.format(new Date(r.sentAt))}` : ''}
              </span>
            </a>
            <span class="badge {r.status}">{r.statusLabel}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if data.requestable.length > 0}
    <section class="card stack">
      <h2>Früheres Quartal holen</h2>
      <form method="POST" action="?/request" use:enhance class="row">
        <label class="sr-only" for="quarter">Quartal</label>
        <select id="quarter" name="quarter">
          {#each data.requestable as q (q.key)}
            <option value={q.key}>{q.label}</option>
          {/each}
        </select>
        <button class="secondary" type="submit">Export holen</button>
      </form>
      {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
    </section>
  {/if}
</div>

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px;
    border-radius: 10px;
    background: var(--surface-2);
  }

  .list a {
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: inherit;
    text-decoration: none;
    min-width: 0;
  }

  .small {
    font-size: 0.8rem;
  }

  .row {
    display: flex;
    gap: 8px;
  }

  .row select {
    flex: 1;
    min-width: 0;
  }

  .note {
    border-color: var(--energy);
  }

  .badge {
    flex: none;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-muted);
  }

  .badge.review,
  .badge.failed {
    color: var(--danger);
  }

  .badge.sent {
    color: var(--ok);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
</style>
