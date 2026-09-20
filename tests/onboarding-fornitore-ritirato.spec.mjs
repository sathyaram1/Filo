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

test('arrivati i crediti, l’accoglienza parte sulla home già aperta', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 10_000 });
  await expect(page.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 15_000 });

  // Il riscatto dell'invito visto da qui: la chiave compare e il main avvisa
  // le pagine. Chi è già sulla home non deve aspettare la scheda dopo.
  await stubProviders(app);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'k-test' } });
    globalThis.SN_BROADCAST_FILO({ type: globalThis.SN_MSG.MSG.CREDITS_CHANGED });
  });

  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 20_000 });
  await expect(page.locator('.dash-bubble-filo').first())
    .toContainText('Ciao, sono Filo', { timeout: 10_000 });
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

// ── Il silenzio può finire mentre la home è già aperta ──────────────────────
//
// La prontezza si decide su modelli e chiavi, e tutti e due arrivano DOPO che
// la prima home è a schermo: la configurazione condivisa la porta una lettura
// di rete, i modelli propri li sceglie l'utente nelle Opzioni. Senza un avviso
// che dica «adesso posso rispondere», l'utente resta sul cartello finché non
// ricarica o apre una scheda nuova: lo stesso sintomo, da un'altra porta.
// Senza il fix questi due test sono rossi (la home resta in stato "home").

test('la configurazione condivisa arriva dalla rete a home già aperta: l’accoglienza parte', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  // Il primissimo avvio: la chiave c'è, i modelli no, perché la lettura di rete
  // che li porta non è ancora finita. Nell'app non ce n'è nessuno scritto.
  await app.evaluate(async () => {
    const Defaults = globalThis.__filoDefaults;
    const origGet = globalThis.__filoDefaultsGet || Defaults.get;
    globalThis.__filoDefaultsGet = origGet;
    globalThis.__filoConfigArrivata = false;
    Defaults.get = () => (globalThis.__filoConfigArrivata
      ? origGet()
      : { ...origGet(), models: {}, modelRegistry: {} });
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'k-test' } });
  });
  await stubProviders(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 10_000 });
  await expect(page.locator('#homeMessage')).toContainText(/nessun modello/i, { timeout: 15_000 });

  await app.evaluate(async () => {
    globalThis.__filoConfigArrivata = true;
    await globalThis.__filoDefaults.refresh().catch(() => {});
  });

  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 25_000 });
  await expect(page.locator('.dash-bubble-filo').first())
    .toContainText('Ciao, sono Filo', { timeout: 10_000 });
});

test('il modello scelto nelle Opzioni a home già aperta: l’accoglienza parte', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  // È la strada che la home stessa propone quando i crediti ci sono e nessun
  // modello risponde: se non porta da nessuna parte, il suggerimento mente.
  await configCondivisa(app, { provider: 'openrouter', models: {} });
  await stubProviders(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#homeMessage')).toContainText(/nessun modello/i, { timeout: 15_000 });

  const azioni = await page.evaluate(() => {
    const A = window.SN_CONST.ACTIONS;
    return { chat: A.FILO_CHAT, home: A.FILO_DASHBOARD };
  });
  await page.evaluate(async (a) => {
    await chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.UPDATE_SETTINGS,
      settings: {
        useDefaultModels: false,
        models: { [a.chat]: 'testo', [a.home]: 'testo' },
        modelRegistry: { testo: { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash-0731' } },
      },
    });
  }, azioni);

  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 25_000 });
  await expect(page.locator('.dash-bubble-filo').first())
    .toContainText('Ciao, sono Filo', { timeout: 10_000 });
});

test('«solo modelli a pesi aperti» senza sostituti: la home nomina l’interruttore', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  const azioni = await page.evaluate(() => {
    const A = window.SN_CONST.ACTIONS;
    return { chat: A.FILO_CHAT, home: A.FILO_DASHBOARD };
  });
  // Crediti a posto e modelli validi: l'unica cosa che spegne Filo è
  // l'interruttore. Dire che la configurazione è vuota manderebbe l'utente a
  // controllare una configurazione in ordine.
  await app.evaluate(async (_e, a) => {
    const Defaults = globalThis.__filoDefaults;
    const origGet = globalThis.__filoDefaultsGet || Defaults.get;
    globalThis.__filoDefaultsGet = origGet;
    Defaults.get = () => ({
      ...origGet(),
      provider: 'openrouter',
      models: { [a.chat]: 'chiuso', [a.home]: 'chiuso' },
      modelRegistry: { chiuso: { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' } },
    });
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'k-test' }, openWeightsOnly: true });
  }, azioni);
  await stubProviders(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 10_000 });
  const messaggio = page.locator('#homeMessage');
  await expect(messaggio).toContainText(/pesi aperti/i, { timeout: 15_000 });
  await expect(messaggio).not.toContainText(/codice d.invito/i);
});

// ── La chiave che non passa dalle impostazioni ──────────────────────────────
//
// Chi entra con un invito non ha una chiave nelle impostazioni: la sua vive nel
// portafoglio. Se il conto di «Filo può rispondere» si aggiorna solo quando
// cambiano impostazioni e configurazione condivisa, per un invitato resta fermo
// su com'era prima del riscatto, e l'avviso che sveglia le home aperte — che
// parte solo quando quel conto CAMBIA — non parte più in nessuna direzione.
// Senza il fix tutti e due questi test sono rossi.

// Il riscatto vero deposita la chiave qui: sostituire la funzione che la legge
// salterebbe proprio il momento che conta.
async function chiaveNelPortafoglio(app, chiave) {
  await app.evaluate((_e, k) => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    const w = req('./auth/wallet-store');
    if (k) w.save({ key: k, pseudonym: 'prova' }); else w.clear();
  }, chiave);
}

async function accoglienzaGiaFatta(app) {
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    const O = globalThis.SN_ONBOARDING;
    await M.setOnboarding(O.close(O.emptyState(), new Date().toISOString()));
  });
}

test('riscattato l’invito, la home già aperta smette di mandare a riscattarlo', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await app.evaluate(async () => {
    const Defaults = globalThis.__filoDefaults;
    const origGet = globalThis.__filoDefaultsGet || Defaults.get;
    globalThis.__filoDefaultsGet = origGet;
    Defaults.get = () => ({ ...origGet(), provider: 'openrouter' });
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: '' } });
  });
  await accoglienzaGiaFatta(app);
  await stubProviders(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 15_000 });
  await expect(page.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 20_000 });

  await chiaveNelPortafoglio(app, 'sk-or-personale-dall-invito');

  await expect(page.locator('#homeMessage')).not.toContainText(/codice d.invito/i, { timeout: 30_000 });
});

test('l’invitato che accende «solo modelli a pesi aperti»: la home lo dice subito', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  const azioni = await page.evaluate(() => {
    const A = window.SN_CONST.ACTIONS;
    return { chat: A.FILO_CHAT, home: A.FILO_DASHBOARD };
  });
  await app.evaluate(async (_e, a) => {
    const Defaults = globalThis.__filoDefaults;
    const origGet = globalThis.__filoDefaultsGet || Defaults.get;
    globalThis.__filoDefaultsGet = origGet;
    Defaults.get = () => ({
      ...origGet(),
      provider: 'openrouter',
      models: { [a.chat]: 'chiuso', [a.home]: 'chiuso' },
      modelRegistry: { chiuso: { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' } },
    });
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: '' } });
  }, azioni);
  await chiaveNelPortafoglio(app, 'sk-or-personale-dall-invito');
  await accoglienzaGiaFatta(app);
  await stubProviders(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 15_000 });
  await expect(page.locator('#homeMessage')).not.toContainText(/pesi aperti/i, { timeout: 20_000 });

  await page.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { openWeightsOnly: true },
    });
  });

  await expect(page.locator('#homeMessage')).toContainText(/pesi aperti/i, { timeout: 30_000 });
});
