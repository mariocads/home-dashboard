<script lang="ts">
  import '../app.css';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: Snippet } = $props();

  const tabs = [
    { href: '/', label: 'Übersicht', icon: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z' },
    { href: '/strom', label: 'Strom', icon: 'M13 2L4 14h7l-1 8 9-12h-7z' },
    {
      href: '/waermepumpe',
      label: 'Wärme',
      icon: 'M12 2c1 4 6 6.5 6 12a6 6 0 0 1-12 0c0-3.3 2-5.6 3.5-7.5.2 2.3 1.2 3.6 2.6 3.9C12.6 7.6 11.4 5 12 2z',
    },
    {
      href: '/kosten',
      label: 'Kosten',
      icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5v2h2v2h-2v4h2v2h-2v2h-2v-2H9v-2h2v-4H9V9h2V7z',
    },
    {
      href: '/einstellungen',
      label: 'Einstellungen',
      icon: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 4l-2.1-.6-.6-1.5 1-2-1.4-1.4-2 1-1.5-.6L13.8 3h-2l-.6 2.1-1.5.6-2-1L6.3 6.1l1 2-.6 1.5L4.6 10v2l2.1.6.6 1.5-1 2 1.4 1.4 2-1 1.5.6.6 2.1h2l.6-2.1 1.5-.6 2 1 1.4-1.4-1-2 .6-1.5L21 14z',
    },
  ] as const;

  const isActive = (href: string) =>
    href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
</script>

{#if data.user}
  <div class="shell">
    <main>
      {@render children()}
    </main>
    <nav aria-label="Hauptnavigation">
      {#each tabs as tab (tab.href)}
        <a
          href={resolve(tab.href)}
          class:active={isActive(tab.href)}
          aria-current={isActive(tab.href) ? 'page' : undefined}
        >
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d={tab.icon} /></svg>
          <span>{tab.label}</span>
        </a>
      {/each}
    </nav>
  </div>
{:else}
  <main class="public">
    {@render children()}
  </main>
{/if}

<style>
  .shell main {
    max-width: 960px;
    margin: 0 auto;
    padding: calc(16px + env(safe-area-inset-top)) 16px
      calc(var(--nav-h) + 24px + env(safe-area-inset-bottom));
  }

  nav {
    position: fixed;
    inset: auto 0 0 0;
    height: calc(var(--nav-h) + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: blur(12px);
    border-top: 1px solid var(--border);
  }

  nav a {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    color: var(--text-muted);
    text-decoration: none;
    font-size: 0.72rem;
  }

  nav svg {
    fill: currentColor;
  }

  nav a.active {
    color: var(--accent);
    font-weight: 600;
  }

  .public {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 24px 16px;
  }

  @media (min-width: 900px) {
    nav {
      inset: 0 auto 0 0;
      width: 96px;
      height: 100dvh;
      grid-template-columns: 1fr;
      grid-auto-rows: 80px;
      align-content: start;
      padding-top: 24px;
      border-top: 0;
      border-right: 1px solid var(--border);
    }

    .shell main {
      padding-left: 120px;
      padding-bottom: 32px;
      max-width: 1100px;
    }
  }
</style>
