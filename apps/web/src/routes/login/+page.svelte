<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto, invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { describeError, loginWithPasskey } from '#lib/passkey.ts';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let busy = $state(false);
  let error = $state('');
  let showRecovery = $state(false);

  async function login() {
    busy = true;
    error = '';
    try {
      await loginWithPasskey();
      await invalidateAll();
      await goto(resolve('/'));
    } catch (e) {
      error = describeError(e);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Anmelden · Home</title></svelte:head>

<div class="card login stack">
  <div class="brand">
    <img src="/icon.svg" alt="" width="56" height="56" />
    <h1>Home Dashboard</h1>
  </div>

  {#if !data.initialized}
    <p class="muted">
      Noch nicht eingerichtet. Am Server ein Setup-Token erzeugen (siehe <code>docs/BETRIEB.md</code>) und den
      angezeigten Link öffnen.
    </p>
  {:else}
    <button onclick={login} disabled={busy} data-testid="login-passkey">
      {busy ? 'Warte auf Passkey…' : 'Mit Passkey anmelden'}
    </button>
    {#if error}<p class="error" role="alert">{error}</p>{/if}

    {#if showRecovery}
      <form method="POST" action="?/recovery" use:enhance class="stack">
        <label for="code">Recovery-Code</label>
        <input
          id="code"
          name="code"
          type="text"
          autocomplete="one-time-code"
          placeholder="XXXX-XXXX-XXXX"
          required
        />
        <button class="secondary" type="submit">Mit Code anmelden</button>
        {#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
      </form>
    {:else}
      <button class="secondary" type="button" onclick={() => (showRecovery = true)}>Passkey verloren?</button>
    {/if}
  {/if}
</div>

<style>
  .login {
    width: 100%;
    max-width: 380px;
  }

  .brand {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
</style>
