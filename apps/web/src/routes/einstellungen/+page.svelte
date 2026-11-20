<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import RecoveryCodes from '#lib/RecoveryCodes.svelte';
  import { defaultDeviceName, describeError, registerPasskey } from '#lib/passkey.ts';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let busy = $state(false);
  let error = $state('');
  let newCodes = $state<string[] | null>(null);

  const fmt = new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium', timeStyle: 'short' });
  const fmtTime = new Intl.DateTimeFormat('de-AT', { dateStyle: 'medium', timeStyle: 'medium' });

  const STATE_LABELS = {
    online: 'Online',
    offline: 'Offline',
    collector: 'Collector läuft nicht',
    waiting: 'Noch keine Rückmeldung',
  } as const;

  // Abschnitte sind zugeklappt; offen nur, wenn es dort etwas zu sehen oder zu tun gibt.
  const passkeysOpen = $derived(data.recovered || !!error || (!!form && 'error' in form && !!form.error));
  const codesOpen = $derived(!!newCodes || (!!form && 'codes' in form && !!form.codes));

  async function addPasskey() {
    busy = true;
    error = '';
    try {
      const result = await registerPasskey(defaultDeviceName());
      newCodes = result.recoveryCodes;
      await invalidateAll();
    } catch (e) {
      error = describeError(e);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet device(d: {
  id: string;
  title: string;
  info: typeof data.amis;
  action: string;
  error: string | null | undefined;
  saved: boolean;
})}
  {@const status = d.info.status}
  <details class="card section" open={!!d.error || d.saved}>
    <summary>
      <h2>{d.title}</h2>
      <span class="status" data-testid="{d.id}-status" data-state={status.state}>
        <span class="dot {status.state}" aria-hidden="true"></span>
        {STATE_LABELS[status.state]}
      </span>
    </summary>
    <div class="body stack">
      {#if status.hint}<p class="small">{status.hint}</p>{/if}
      <dl class="facts small">
        {#if status.target}
          <dt>Adresse</dt>
          <dd>{status.target}</dd>
        {/if}
        {#if status.checkedAt}
          <dt>Letzte Abfrage</dt>
          <dd>{fmtTime.format(new Date(status.checkedAt))}</dd>
        {/if}
        <dt>Letzter Messwert</dt>
        <dd>{d.info.lastValueAt ? fmtTime.format(new Date(d.info.lastValueAt)) : 'noch keiner'}</dd>
        {#if status.error}
          <dt>Meldung</dt>
          <dd><code>{status.error}</code></dd>
        {/if}
      </dl>
      <form
        method="POST"
        action={d.action}
        use:enhance={() =>
          async ({ update }) =>
            update({ reset: false })}
      >
        <label for="{d.id}-interval">Abfrageintervall in Sekunden</label>
        <div class="row">
          <input
            id="{d.id}-interval"
            name="interval"
            type="number"
            inputmode="numeric"
            required
            min={d.info.min}
            max={d.info.max}
            step="1"
            value={d.info.interval}
          />
          <button class="secondary" type="submit">Speichern</button>
        </div>
      </form>
      {#if d.error}
        <p class="error" role="alert">{d.error}</p>
      {:else if d.saved}
        <p class="muted small" role="status">
          Gespeichert. Der Collector übernimmt den Wert innerhalb von 10 s.
        </p>
      {/if}
    </div>
  </details>
{/snippet}

<svelte:head><title>Einstellungen · Home</title></svelte:head>

<div class="stack">
  <h1>Einstellungen</h1>

  {#if data.recovered}
    <section class="card warn" role="status">
      <strong>Mit Recovery-Code angemeldet.</strong>
      <p>Bitte jetzt einen neuen Passkey für dieses Gerät anlegen.</p>
    </section>
  {/if}

  {@render device({
    id: 'amis',
    title: 'AMIS-Leser',
    info: data.amis,
    action: '?/saveAmisInterval',
    error: form && 'amisError' in form ? form.amisError : null,
    saved: !!form && 'amisSaved' in form,
  })}

  {@render device({
    id: 'isg',
    title: 'Wärmepumpe (ISG)',
    info: data.isg,
    action: '?/saveIsgInterval',
    error: form && 'isgError' in form ? form.isgError : null,
    saved: !!form && 'isgSaved' in form,
  })}

  <details class="card section" open={passkeysOpen}>
    <summary>
      <h2>Passkeys</h2>
      <span class="summary-info">
        {data.passkeys.length === 1 ? '1 Passkey' : `${data.passkeys.length} Passkeys`}
      </span>
    </summary>
    <div class="body stack">
      <ul class="list" data-testid="passkey-list">
        {#each data.passkeys as pk (pk.id)}
          <li>
            <div>
              <strong>{pk.name}</strong>
              <div class="muted small">
                angelegt {fmt.format(new Date(pk.createdAt))}{#if pk.lastUsedAt}
                  · zuletzt {fmt.format(new Date(pk.lastUsedAt))}{/if}{#if pk.synced}
                  · synchronisiert{/if}
              </div>
            </div>
            {#if data.passkeys.length > 1}
              <form method="POST" action="?/deletePasskey" use:enhance>
                <input type="hidden" name="id" value={pk.id} />
                <button class="danger" type="submit" aria-label="Passkey {pk.name} entfernen">
                  Entfernen
                </button>
              </form>
            {/if}
          </li>
        {/each}
      </ul>
      <button class="secondary" onclick={addPasskey} disabled={busy}>
        {busy ? 'Warte auf Passkey…' : 'Passkey für dieses Gerät hinzufügen'}
      </button>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      {#if form && 'error' in form && form.error}<p class="error" role="alert">{form.error}</p>{/if}
      <p class="muted small">Tipp: mindestens zwei Passkeys anlegen, z. B. am Handy und am Laptop.</p>
    </div>
  </details>

  <details class="card section" open={codesOpen}>
    <summary>
      <h2>Recovery-Codes</h2>
      <span class="summary-info" class:low={data.recoveryCodesLeft <= 2}>
        {data.recoveryCodesLeft} von 10 unbenutzt
      </span>
    </summary>
    <div class="body stack">
      {#if form && 'codes' in form && form.codes}
        <RecoveryCodes codes={form.codes} />
      {:else if newCodes}
        <RecoveryCodes codes={newCodes} />
      {:else}
        <p class="muted">{data.recoveryCodesLeft} von 10 Codes noch unbenutzt.</p>
      {/if}
      <form method="POST" action="?/regenerateCodes" use:enhance>
        <button class="secondary" type="submit">Neue Codes erzeugen (alte werden ungültig)</button>
      </form>
    </div>
  </details>

  <section class="card">
    <form method="POST" action="?/logout">
      <button class="secondary" type="submit" data-testid="logout">Abmelden</button>
    </form>
  </section>
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

  .small {
    font-size: 0.8rem;
  }

  .row {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }

  .row input {
    flex: 1;
    min-width: 0;
  }

  .warn {
    border-color: var(--energy);
  }

  .section > summary {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 32px;
    cursor: pointer;
    list-style: none;
  }

  .section > summary::-webkit-details-marker {
    display: none;
  }

  .section > summary h2 {
    flex: 1;
    margin: 0;
  }

  /* Pfeil rechts, zeigt nach unten wenn zu, nach oben wenn offen */
  .section > summary::after {
    content: '';
    flex: none;
    width: 8px;
    height: 8px;
    margin: 0 4px 4px;
    border-right: 2px solid var(--text-muted);
    border-bottom: 2px solid var(--text-muted);
    transform: rotate(45deg);
    transition: transform 0.15s;
  }

  .section[open] > summary::after {
    margin-bottom: -4px;
    transform: rotate(-135deg);
  }

  .section > .body {
    margin-top: var(--gap);
  }

  .summary-info {
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .summary-info.low {
    color: var(--danger);
  }

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--text-muted);
  }

  .dot.online {
    background: var(--ok);
  }

  .dot.offline,
  .dot.collector {
    background: var(--danger);
  }

  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 12px;
    margin: 0;
    color: var(--text-muted);
  }

  .facts dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
