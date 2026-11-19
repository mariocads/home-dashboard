<script lang="ts">
  import CostView from '#lib/CostView.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<CostView {data} />
