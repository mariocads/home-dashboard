<script lang="ts">
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import { eurFormat, formatDateKey, formatMonthKey, priceFormat } from '#lib/format.ts';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  type Tariff = PageData['tariffs'][number];
  type Installment = PageData['installments'][number];
  type Invoice = PageData['invoices'][number];

  const CATEGORIES = [
    ['energie', 'Energie'],
    ['netz', 'Netz'],
    ['abgaben', 'Steuern und Abgaben'],
  ] as const;
  const UNITS = [
    ['ct_kwh', 'ct/kWh'],
    ['eur_year', '€/Jahr'],
    ['eur_month', '€/Monat'],
  ] as const;

  const payees = $derived([...new Set([...data.tariffs, ...data.installments].map((t) => t.payee))].sort());
  const byPayee = $derived(
    payees
      .map((payee) => ({ payee, tariffs: data.tariffs.filter((t) => t.payee === payee) }))
      .filter((g) => g.tariffs.length > 0),
  );

  /** Zahl für Eingabefelder mit Komma, ohne Gleitkomma-Rauschen. */
  const decimal = (v: number) => String(Math.round(v * 1e6) / 1e6).replace('.', ',');
  /** Monate kompakt, z. B. [4,5,6,7,8,9] → „4-9“ */
  function monthsText(months: number[]): string {
    const runs: string[] = [];
    let i = 0;
    while (i < months.length) {
      let j = i;
      while (j + 1 < months.length && months[j + 1] === months[j]! + 1) j++;
      runs.push(i === j ? `${months[i]}` : `${months[i]}-${months[j]}`);
      i = j + 1;
    }
    return runs.join(',');
  }
  const validity = (from: string, to: string | null) =>
    to ? `${formatDateKey(from)} – ${formatDateKey(to)}` : `ab ${formatDateKey(from)}`;

  const message = (scope: string) =>
    form && 'scope' in form && form.scope === scope
      ? 'error' in form && form.error
        ? { error: true, text: form.error }
        : 'saved' in form && form.saved
          ? { error: false, text: 'Gespeichert.' }
          : null
      : null;

  const keep =
    () =>
    async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) =>
      update({ reset: false });
</script>

<svelte:head><title>Tarife · Home</title></svelte:head>

<datalist id="payees">
  {#each payees as p (p)}<option value={p}></option>{/each}
</datalist>

{#snippet tariffForm(t: Tariff | null)}
  {@const p = `t-${t?.id ?? 'new'}`}
  <form method="POST" action="?/saveTariff" use:enhance={keep} class="form">
    {#if t}<input type="hidden" name="id" value={t.id} />{/if}
    <label for="{p}-payee">Zahlungsempfänger</label>
    <input id="{p}-payee" name="payee" type="text" list="payees" required value={t?.payee ?? ''} />
    <label for="{p}-name">Bezeichnung</label>
    <input id="{p}-name" name="name" type="text" required value={t?.name ?? ''} />
    <div class="cols">
      <div>
        <label for="{p}-category">Kategorie</label>
        <select id="{p}-category" name="category">
          {#each CATEGORIES as [value, label] (value)}
            <option {value} selected={t?.category === value}>{label}</option>
          {/each}
        </select>
      </div>
      <div>
        <label for="{p}-unit">Einheit</label>
        <select id="{p}-unit" name="unit">
          {#each UNITS as [value, label] (value)}
            <option {value} selected={t?.unit === value}>{label}</option>
          {/each}
        </select>
      </div>
    </div>
    <div class="cols">
      <div>
        <label for="{p}-price">Preis</label>
        <input
          id="{p}-price"
          name="price"
          type="text"
          inputmode="decimal"
          required
          value={t ? decimal(t.priceNet) : ''}
        />
      </div>
      <div>
        <label for="{p}-mode">Preis ist</label>
        <select id="{p}-mode" name="priceMode">
          <option value="net">netto</option>
          <option value="gross">brutto</option>
        </select>
      </div>
      <div>
        <label for="{p}-vat">USt in %</label>
        <input
          id="{p}-vat"
          name="vatPct"
          type="number"
          min="0"
          max="100"
          step="any"
          value={t?.vatPct ?? 20}
        />
      </div>
    </div>
    <div class="cols">
      <div>
        <label for="{p}-from">Gültig ab</label>
        <input id="{p}-from" name="validFrom" type="date" required value={t?.validFrom ?? ''} />
      </div>
      <div>
        <label for="{p}-to">Gültig bis (optional)</label>
        <input id="{p}-to" name="validTo" type="date" value={t?.validTo ?? ''} />
      </div>
    </div>
    <fieldset>
      <legend>Zeitfenster (optional, nur ct/kWh)</legend>
      <div class="cols">
        <div>
          <label for="{p}-wm">Monate, z. B. 4-9</label>
          <input
            id="{p}-wm"
            name="windowMonths"
            type="text"
            value={t?.window ? monthsText(t.window.months) : ''}
          />
        </div>
        <div>
          <label for="{p}-wh">Stunden, z. B. 10-16</label>
          <input
            id="{p}-wh"
            name="windowHours"
            type="text"
            value={t?.window ? `${t.window.fromHour}-${t.window.toHour}` : ''}
          />
        </div>
      </div>
    </fieldset>
    <label for="{p}-note">Notiz (optional)</label>
    <input id="{p}-note" name="note" type="text" value={t?.note ?? ''} />
    <button type="submit">{t ? 'Speichern' : 'Anlegen'}</button>
  </form>
{/snippet}

{#snippet installmentForm(i: Installment | null)}
  {@const p = `i-${i?.id ?? 'new'}`}
  <form method="POST" action="?/saveInstallment" use:enhance={keep} class="form">
    {#if i}<input type="hidden" name="id" value={i.id} />{/if}
    <label for="{p}-payee">Zahlungsempfänger</label>
    <input id="{p}-payee" name="payee" type="text" list="payees" required value={i?.payee ?? ''} />
    <label for="{p}-amount">Betrag brutto pro Monat in €</label>
    <input
      id="{p}-amount"
      name="amountGross"
      type="text"
      inputmode="decimal"
      required
      value={i ? decimal(i.amountGross) : ''}
    />
    <div class="cols">
      <div>
        <label for="{p}-from">Ab Monat</label>
        <input id="{p}-from" name="fromMonth" type="month" required value={i?.fromMonth ?? ''} />
      </div>
      <div>
        <label for="{p}-to">Bis Monat (optional)</label>
        <input id="{p}-to" name="toMonth" type="month" value={i?.toMonth ?? ''} />
      </div>
    </div>
    <button type="submit">{i ? 'Speichern' : 'Anlegen'}</button>
  </form>
{/snippet}

{#snippet invoiceForm(v: Invoice | null)}
  {@const p = `v-${v?.id ?? 'new'}`}
  <form method="POST" action="?/saveInvoice" use:enhance={keep} class="form">
    {#if v}<input type="hidden" name="id" value={v.id} />{/if}
    <label for="{p}-payee">Zahlungsempfänger</label>
    <input id="{p}-payee" name="payee" type="text" list="payees" required value={v?.payee ?? ''} />
    <div class="cols">
      <div>
        <label for="{p}-from">Zeitraum von</label>
        <input id="{p}-from" name="fromDate" type="date" required value={v?.fromDate ?? ''} />
      </div>
      <div>
        <label for="{p}-to">bis</label>
        <input id="{p}-to" name="toDate" type="date" required value={v?.toDate ?? ''} />
      </div>
    </div>
    <label for="{p}-amount">Rechnungsbetrag brutto in € (ohne Teilzahlungen abzuziehen)</label>
    <input
      id="{p}-amount"
      name="amountGross"
      type="text"
      inputmode="decimal"
      required
      value={v ? decimal(v.amountGross) : ''}
    />
    <label for="{p}-note">Notiz (optional)</label>
    <input id="{p}-note" name="note" type="text" value={v?.note ?? ''} />
    <button type="submit">{v ? 'Speichern' : 'Anlegen'}</button>
  </form>
{/snippet}

{#snippet deleteButton(action: string, id: number, label: string)}
  <form method="POST" {action} use:enhance>
    <input type="hidden" name="id" value={id} />
    <button class="danger" type="submit" aria-label="{label} löschen">Löschen</button>
  </form>
{/snippet}

{#snippet feedback(scope: string)}
  {@const m = message(scope)}
  {#if m}
    <p class={m.error ? 'error' : 'muted small'} role={m.error ? 'alert' : 'status'}>{m.text}</p>
  {/if}
{/snippet}

<div class="stack">
  <header>
    <a class="back" href={resolve('/kosten')}>← Kosten</a>
    <h1>Tarife</h1>
  </header>

  <section class="card stack" aria-labelledby="file-heading">
    <h2 id="file-heading">Tarifdatei</h2>
    <p class="muted small">
      Preise, Teilzahlungen und Rechnungen als JSON-Datei übernehmen oder sichern. Die Datei bleibt lokal (z.
      B. im Ordner <code>prep</code>), sie gehört nicht ins Repo. Einträge mit gleichem Empfänger, Bezeichnung
      und Beginn werden überschrieben.
    </p>
    <form method="POST" action="?/importJson" enctype="multipart/form-data" use:enhance class="stack">
      <label for="tariff-file">JSON-Datei</label>
      <input id="tariff-file" name="file" type="file" accept=".json,application/json" required />
      <div class="row">
        <button type="submit">Übernehmen</button>
        <a class="button secondary-link" href={resolve('/kosten/tarife/export')} download>Sichern</a>
      </div>
    </form>
    {#if form && 'imported' in form && form.imported}
      <p class="muted small" role="status">
        Übernommen: {form.imported.tariffs} Preiskomponenten, {form.imported.installments} Teilzahlungen,
        {form.imported.invoices} Rechnungen.
      </p>
    {/if}
    {@render feedback('import')}
  </section>

  <section class="card stack" aria-labelledby="tariff-heading">
    <h2 id="tariff-heading">Preiskomponenten</h2>
    <p class="muted small">
      Preise netto gespeichert; die Anzeige ist brutto. Abschläge (z. B. Sommer-Niedertarif) als negativer
      Preis mit Zeitfenster.
    </p>
    {@render feedback('tariff')}
    {#each byPayee as g (g.payee)}
      <h3>{g.payee}</h3>
      <ul class="list" data-testid="tariff-list">
        {#each g.tariffs as t (t.id)}
          <li>
            <details>
              <summary>
                <span class="title">{t.name}</span>
                <span class="muted small">
                  {priceFormat.format(t.priceGross)}
                  {t.unitLabel} brutto · {validity(t.validFrom, t.validTo)}{t.windowLabel
                    ? ` · ${t.windowLabel}`
                    : ''}
                </span>
                {#if t.note}<span class="muted small">{t.note}</span>{/if}
              </summary>
              {@render tariffForm(t)}
              {@render deleteButton('?/deleteTariff', t.id, t.name)}
            </details>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">Noch keine Preiskomponenten.</p>
    {/each}
    <details class="new">
      <summary>Neue Preiskomponente</summary>
      {@render tariffForm(null)}
    </details>
  </section>

  <section class="card stack" aria-labelledby="inst-heading">
    <h2 id="inst-heading">Teilzahlungen</h2>
    {@render feedback('installment')}
    <ul class="list" data-testid="installment-list">
      {#each data.installments as i (i.id)}
        <li>
          <details>
            <summary>
              <span class="title">{i.payee} · {eurFormat.format(i.amountGross)} / Monat</span>
              <span class="muted small">
                {i.toMonth
                  ? `${formatMonthKey(i.fromMonth)} – ${formatMonthKey(i.toMonth)}`
                  : `ab ${formatMonthKey(i.fromMonth)}`}
              </span>
            </summary>
            {@render installmentForm(i)}
            {@render deleteButton('?/deleteInstallment', i.id, `Teilzahlung ${i.payee}`)}
          </details>
        </li>
      {:else}
        <li class="muted">Noch keine Teilzahlungen.</li>
      {/each}
    </ul>
    <details class="new">
      <summary>Neue Teilzahlung</summary>
      {@render installmentForm(null)}
    </details>
  </section>

  <section class="card stack" aria-labelledby="inv-heading">
    <h2 id="inv-heading">Rechnungen</h2>
    <p class="muted small">Für den Abgleich mit der Berechnung auf der Kostenseite.</p>
    {@render feedback('invoice')}
    <ul class="list">
      {#each data.invoices as v (v.id)}
        <li>
          <details>
            <summary>
              <span class="title">{v.payee} · {eurFormat.format(v.amountGross)}</span>
              <span class="muted small">{formatDateKey(v.fromDate)} – {formatDateKey(v.toDate)}</span>
            </summary>
            {@render invoiceForm(v)}
            {@render deleteButton('?/deleteInvoice', v.id, `Rechnung ${v.payee}`)}
          </details>
        </li>
      {:else}
        <li class="muted">Noch keine Rechnungen.</li>
      {/each}
    </ul>
    <details class="new">
      <summary>Neue Rechnung</summary>
      {@render invoiceForm(null)}
    </details>
  </section>
</div>

<style>
  .back {
    font-size: 0.9rem;
  }

  h3 {
    font-size: 0.95rem;
    margin: 4px 0 0;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .list > li {
    border-radius: 10px;
    background: var(--surface-2);
    padding: 10px 12px;
  }

  summary {
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 2px;
    list-style: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  .new > summary {
    color: var(--accent);
    font-weight: 600;
    padding: 8px 0;
  }

  .title {
    font-weight: 600;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 12px;
  }

  .form button {
    margin-top: 8px;
  }

  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 8px;
  }

  .cols > div {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  fieldset {
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 8px 12px 12px;
    margin: 6px 0 0;
  }

  legend {
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .secondary-link {
    background: var(--surface-2);
    color: var(--text);
  }

  .small {
    font-size: 0.8rem;
  }
</style>
