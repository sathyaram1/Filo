// #663 — «Filo è pronto?» non si decide sul fornitore dichiarato.
//
// Nella configurazione condivisa il campo che nomina il fornitore era rimasto a
// un fornitore ritirato, mentre ogni modello del registro dichiara il suo e la
// chiave che Filo possiede è quella. Le chiamate funzionavano; il controllo di
// prontezza, che cercava una chiave INTESTATA al fornitore dichiarato, no. Il
// risultato era un'assenza muta: l'accoglienza non partiva mai e la home
// restava quella di chi non ha modo di pagare i modelli.
//
// Senza il fix il primo test è rosso (la home resta in stato "home" col
// cartello dell'invito) e il terzo pure (il messaggio parla di crediti quando i
// crediti ci sono).

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

// La configurazione condivisa com'era sul campo: fornitore dichiarato che non
// esiste più, modelli del registro di prova (tutti su OpenRouter), chiave
// OpenRouter valida. `models` opzionale per spegnere anche i modelli.
async function configCondivisa(app, { provider, models }) {
  await app.evaluate(async (_electron, cfg) => {
    const Defaults = globalThis.__filoDefaults;
    const origGet = globalThis.__filoDefaultsGet || Defaults.get;
    globalThis.__filoDefaultsGet = origGet;
    Defaults.get = () => {
      const base = origGet();
      return { ...base, provider: cfg.provider, ...(cfg.models ? { models: cfg.models } : {}) };
    };
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'k-test' } });
  }, { provider, models });
}

async function stubProviders(app) {
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    const risposta = (attempts) => ({
      text: JSON.stringify({ message: 'Buongiorno.', suggestions: [] }),
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    P.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const r = risposta(attempts);
      try { onDelta && onDelta(r.text); } catch (_) {}
      return r;
    };
    P.completeWithFallback = async ({ attempts }) => risposta(attempts);
  });
}

test('il fornitore dichiarato non esiste più ma i modelli hanno la chiave: l’accoglienza parte', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configCondivisa(app, { provider: 'gemini' });
  await stubProviders(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  // Il punto di vista dell'utente: Filo si presenta, con la sua prima frase.
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
  await expect(page.locator('.dash-bubble-filo').first())
    .toContainText('Ciao, sono Filo', { timeout: 10_000 });
});

test('lo stesso vale aprendo una scheda nuova, senza ricaricare niente', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await configCondivisa(app, { provider: 'gemini' });
  await stubProviders(app);
  const prima = new Set(app.windows());
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/newtab.html'));
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 10_000 });

  const deadline = Date.now() + 10_000;
  let page = null;
  while (Date.now() < deadline && !page) {
    page = app.windows().find((w) => !prima.has(w) && w.url().startsWith('filo://newtab'));
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  if (!page) throw new Error('la scheda nuova non è comparsa');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
});

test('se davvero non c’è nessun modello da chiamare, la home lo dice invece di tacere', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  // Crediti a posto (la chiave c'è), configurazione dei modelli vuota: prima
  // l'utente leggeva «serve un codice d'invito» e andava a cercare crediti che
  // aveva già.
  await configCondivisa(app, { provider: 'openrouter', models: {} });
  await stubProviders(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 10_000 });
  const messaggio = page.locator('#homeMessage');
  await expect(messaggio).toContainText(/nessun modello/i, { timeout: 15_000 });
  await expect(messaggio).not.toContainText(/codice d.invito/i);
});
