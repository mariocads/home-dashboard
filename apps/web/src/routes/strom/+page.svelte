<script lang="ts">
  import { resolve } from '$app/paths';
</script>

<svelte:head><title>Strom · Home</title></svelte:head>

<div class="stack">
  <h1>Strom</h1>
  <section class="card stack">
    <h2>Daten</h2>
    <p class="muted">
      Lastprofil, Grundlast, Heatmap und der Vergleich zu Vormonat und Vorjahr folgen im nächsten Schritt.
      Zuerst die Viertelstundenwerte aus dem NetzOÖ-Portal importieren.
    </p>
    <a class="button" href={resolve('/strom/import')}>NetzOÖ-Export importieren</a>
  </section>
</div>
