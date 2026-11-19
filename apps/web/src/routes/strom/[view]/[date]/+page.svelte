<script lang="ts">
  import ElectricityView from '#lib/ElectricityView.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<ElectricityView {data} />
