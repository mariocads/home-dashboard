<script lang="ts">
  import HeatPumpView from '#lib/HeatPumpView.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<HeatPumpView view={data.view} />
