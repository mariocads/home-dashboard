<script lang="ts">
  import { onMount } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import RecoveryCodes from '#lib/RecoveryCodes.svelte';
  import { defaultDeviceName, describeError, passkeysSupported, registerPasskey } from '#lib/passkey.ts';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let name = $state('Passkey');
  let busy = $state(false);
  let error = $state('');
  let codes = $state<string[] | null>(null);
  let supported = $state(true);

  onMount(() => {
    name = defaultDeviceName();
    supported = passkeysSupported();
  });

  async function register() {
    busy = true;
    error = '';
    try {
      const result = await registerPasskey(name);
      if (result.recoveryCodes) {
        codes = result.recoveryCodes;
      } else {
        await finish();
      }
    } catch (e) {
      error = describeError(e);
    } finally {
      busy = false;
    }
  }

  async function finish() {
    await invalidateAll();
    await goto(resolve('/'));
  }
</script>

<svelte:head><title>Einrichtung · Home</title></svelte:head>

<div class="card setup stack">
  <h1>Einrichtung</h1>

  {#if codes}
    <RecoveryCodes {codes} />
    <button onclick={finish} data-testid="setup-done">Gespeichert – weiter zum Dashboard</button>
  {:else if !data.valid}
    <p class="error">Der Einrichtungslink ist ungültig, abgelaufen oder wurde bereits verwendet.</p>
    <p class="muted">Am Server einen neuen Link erzeugen: <code>docs/BETRIEB.md</code> → „Setup-Token“.</p>
  {:else if !supported}
    <p class="error">
      Dieser Browser unterstützt keine Passkeys, oder die Seite läuft nicht über vertrauenswürdiges HTTPS.
    </p>
  {:else}
    <p class="muted">Lege einen Passkey für dieses Gerät an (Face-ID, Fingerabdruck oder Geräte-PIN).</p>
    <label for="name">Name des Geräts</label>
    <input id="name" type="text" bind:value={name} maxlength="60" />
    <button onclick={register} disabled={busy} data-testid="setup-register">
      {busy ? 'Warte auf Passkey…' : 'Passkey anlegen'}
    </button>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {/if}
</div>

<style>
  .setup {
    width: 100%;
    max-width: 420px;
  }
</style>
