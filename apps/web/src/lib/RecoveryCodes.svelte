<script lang="ts">
  let { codes }: { codes: string[] } = $props();
</script>

<div class="stack">
  <h2>Recovery-Codes</h2>
  <p>
    Diese Codes werden <strong>nur jetzt</strong> angezeigt. Jeder Code funktioniert genau einmal, falls kein Passkey
    mehr verfügbar ist. Sicher aufbewahren, z. B. im Passwortmanager.
  </p>
  <ul class="codes" data-testid="recovery-codes">
    {#each codes as code (code)}
      <li>{code}</li>
    {/each}
  </ul>
</div>
