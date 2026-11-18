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

  .warn {
    border-color: var(--energy);
  }
</style>
