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
  const status = $derived(data.amis.status);

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

<svelte:head><title>Einstellungen · Home</title></svelte:head>

<div class="stack">
  <h1>Einstellungen</h1>

  {#if data.recovered}
    <section class="card warn" role="status">
      <strong>Mit Recovery-Code angemeldet.</strong>
      <p>Bitte jetzt einen neuen Passkey für dieses Gerät anlegen.</p>
    </section>
  {/if}

  <section class="card stack" aria-labelledby="amis-heading">
    <h2 id="amis-heading">AMIS-Leser</h2>
    <div class="status" data-testid="amis-status" data-state={status.state}>
      <span class="dot {status.state}" aria-hidden="true"></span>
      <strong>{STATE_LABELS[status.state]}</strong>
    </div>
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
      <dd>
        {#if data.amis.power}
          {fmtTime.format(new Date(data.amis.power.ts))}
        {:else}
          noch keiner
        {/if}
      </dd>
      {#if status.error}
        <dt>Meldung</dt>
        <dd><code>{status.error}</code></dd>
      {/if}
    </dl>
    <form
      method="POST"
      action="?/saveAmisInterval"
      use:enhance={() =>
        async ({ update }) =>
          update({ reset: false })}
    >
      <label for="amis-interval">Abfrageintervall in Sekunden</label>
      <div class="row">
        <input
          id="amis-interval"
          name="interval"
          type="number"
          inputmode="numeric"
          required
          min={data.amis.min}
          max={data.amis.max}
          step="1"
          value={data.amis.interval}
        />
        <button class="secondary" type="submit">Speichern</button>
      </div>
    </form>
    {#if form && 'amisError' in form && form.amisError}
      <p class="error" role="alert">{form.amisError}</p>
    {:else if form && 'amisSaved' in form && form.amisSaved}
      <p class="muted small" role="status">
        Gespeichert. Der Collector übernimmt den Wert innerhalb von 10 s.
      </p>
    {/if}
  </section>

  <section class="card stack">
    <h2>Passkeys</h2>
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
              <button class="danger" type="submit" aria-label="Passkey {pk.name} entfernen">Entfernen</button>
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
  </section>

  <section class="card stack">
    <h2>Recovery-Codes</h2>
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
  </section>

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

  .status {
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
