// Richiesta: "il box dove si scrive il codice del modello dovrebbe essere un
// menu a tendina con tutti i modelli di quel provider, con possibilità di
// scrivere per cercare".
//
// Implementazione: il campo "stringa modello" di ogni riga del registry è un
// combobox (input + <datalist>) legato al PROVIDER della riga; la lista è
// seminata con i modelli già nel registry e poi completata via API.
//
// Questi test asseriscono il COMPORTAMENTO, senza dipendere dalla rete:
//   1. Il campo è legato alla datalist del provider (niente popup nativo).
//   2. Un modello salvato compare nella tendina alla riapertura.
//   3. Una lista che arriva dopo il fuoco apre la tendina rimasta vuota.

import { test, expect } from './fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';

// NB: `.sn-model-row` è usata sia dal registry editor (#modelRegistryList) sia
// dalla lista read-only dei modelli predefiniti (#defaultModelsList): scopare
// SEMPRE le query a #modelRegistryList per non prendere le righe sbagliate.
const ROW = '#modelRegistryList .sn-model-row:not(.sn-model-row-head)';

// Il catalogo del fornitore arriva dalla rete quando arriva e SOSTITUISCE la lista della tendina: una voce messa
// a mano prima spariva sulla macchina che la rete ce l'ha (#687). Lo serve la prova; `trattieni` aspetta
// `__rilasciaCatalogo()`.
async function serviCatalogo(app, ids, { trattieni = false } = {}) {
  await app.context().addInitScript(({ ids, trattieni }) => {
    let apri = () => {};
    const via = trattieni ? new Promise((r) => { apri = r; }) : Promise.resolve();
    window.__rilasciaCatalogo = () => apri();
    const orig = window.fetch;
    window.fetch = function (url) {
      if (!/^https:\/\/openrouter\.ai\/api\/v1\/models/.test(String(url))) return orig.apply(this, arguments);
      return via.then(() => new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }),
        { status: 200, headers: { 'content-type': 'application/json' } }));
    };
  }, { ids, trattieni });
}

const lista = (page) => page.evaluate(() =>
  [...document.getElementById('models-list-openrouter').options].map((o) => o.value));

async function revealAdvanced(page) {
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  await page.uncheck('#useDefaultModels');
  await page.waitForSelector('#sec-model-registry:not([hidden])', { timeout: 4_000 });
  await page.waitForSelector(ROW, { timeout: 8_000 });
}

test('Modelli: il campo è un combobox custom legato al provider della riga', async ({ app, openTab }) => {
  await serviCatalogo(app, ['vendor/modello-di-prova']);
  const page = await openTab(OPTIONS_URL);
  await revealAdvanced(page);

  // La datalist del provider esiste (sorgente dati del combobox); la vecchia
  // "models-list" condivisa no, e non c'è più quella di un'API diretta di Google.
  expect(await page.locator('#models-list-openrouter').count()).toBe(1);
  expect(await page.locator('#models-list').count()).toBe(0);
  expect(await page.locator('#models-list-gemini').count()).toBe(0);

  const row = page.locator(ROW).first();
  const idInput = row.locator('.sn-model-id');

  // Niente più popup NATIVO della datalist: il campo non ha l'attributo `list`
  // (senza il fix questo è rosso). Il dropdown ora è quello custom .sn-select-*.
  await expect(idInput).not.toHaveAttribute('list', /.*/);

  // Il catalogo del fornitore entra nella lista del combobox.
  await expect.poll(() => lista(page), { timeout: 6_000 }).toContain('vendor/modello-di-prova');

  // Aprendo il campo, il dropdown custom mostra il modello del catalogo. Col clic, il gesto dell'utente: un `focus()`
  // dato da fuori non genera l'evento in una finestra che il fuoco non ce l'ha.
  await row.locator('.sn-model-provider').selectOption('openrouter');
  await idInput.click();
  // Scope al wrapper del campo: anche il <select> del provider è un menu custom
  // di Filo con il suo .sn-select-pop, quindi nella riga ce n'è più d'uno.
  const pop = row.locator('.sn-model-id-wrap .sn-select-pop');
  await expect(pop).toBeVisible({ timeout: 4_000 });
  await expect(pop.locator('.sn-select-option', { hasText: 'vendor/modello-di-prova' })).toBeVisible();
});

test('Modelli: se la lista arriva dopo il fuoco, la tendina rimasta vuota si apre da sé', async ({ app, openTab }) => {
  // Registro vuoto (il caso di chi spegne i modelli predefiniti): finché il catalogo non arriva non c'è niente da
  // proporre, e la tendina restava chiusa sotto il campo a fuoco finché non si cliccava di nuovo.
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, modelRegistry: {} });
  });
  await serviCatalogo(app, ['vendor/arrivato-dopo'], { trattieni: true });
  const page = await openTab(OPTIONS_URL);
  await page.waitForSelector(ROW, { timeout: 8_000 });

  const row = page.locator(ROW).first();
  const idInput = row.locator('.sn-model-id');
  const pop = row.locator('.sn-model-id-wrap .sn-select-pop');
  await idInput.click();
  expect(await lista(page)).toEqual([]);
  await expect(pop).toBeHidden();

  await page.evaluate(() => window.__rilasciaCatalogo());
  await expect(pop).toBeVisible({ timeout: 6_000 });
  await expect(pop.locator('.sn-select-option', { hasText: 'vendor/arrivato-dopo' })).toBeVisible();
  await expect(idInput).toBeFocused();
});

test('Modelli: un modello salvato compare nella tendina alla riapertura', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await revealAdvanced(page);

  // Compila la prima riga con un modello e salva.
  await page.evaluate(() => {
    const row = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
    row.querySelector('.sn-model-nick').value = 'miomodello';
    row.querySelector('.sn-model-provider').value = 'openrouter';
    row.querySelector('.sn-model-id').value = 'vendor/modello-salvato';
    row.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
  // Il salvataggio è differito: si aspetta che il registro salvato contenga la riga.
  await expect.poll(() => page.evaluate(async () => {
    const s = await window.SN_STORAGE.getSettings();
    return (s.modelRegistry && s.modelRegistry.miomodello && s.modelRegistry.miomodello.model) || '';
  }), { timeout: 5_000 }).toBe('vendor/modello-salvato');

  // Ricarica: il seeding della tendina parte dal registry salvato.
  await page.reload();
  await revealAdvanced(page);

  await page.waitForFunction(() => {
    const dl = document.getElementById('models-list-openrouter');
    return !!dl && [...dl.options].some((o) => o.value === 'vendor/modello-salvato');
  }, null, { timeout: 6_000 });
});
