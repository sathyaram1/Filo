// Verifica #663, giro 2 — la home già aperta si accorge di quello che cambia,
// in tutte e due le direzioni.
//
// Il giro 1 ha chiuso le porte in cui Filo DIVENTA capace di rispondere mentre
// l'utente è davanti alla home e l'accoglienza non è ancora stata fatta: lì
// quello che parte è l'intervista. Qui si provano le porte rimaste:
//
//  1. chi l'accoglienza l'ha già fatta (la stragrande maggioranza delle
//     aperture, dalla seconda in poi) non ha nessuna intervista da far
//     partire: quello che deve cambiare è il MESSAGGIO della home;
//  2. la direzione opposta — Filo smette di poter rispondere mentre la home è
//     aperta — deve dirlo dove si vede, che è la seconda metà della richiesta
//     («se davvero non c'è nessuna chiave da nessuna parte, deve dirlo dove si
//     vede, non limitarsi a non presentarsi»);
//  3. il fornitore dichiarato ritirato non deve spegnere la chat della home,
//     non solo l'accoglienza.

import { test, expect } from '../../fixtures/electron.mjs';

const FRASE_DEL_MODELLO = 'Ecco la tua home su misura.';

async function configCondivisa(app, patch) {
  await app.evaluate(async (_electron, cfg) => {
    const Defaults = globalThis.__filoDefaults;
    const orig = globalThis.__filoDefaultsOrigGet || Defaults.get;
    globalThis.__filoDefaultsOrigGet = orig;
    Defaults.get = () => ({ ...orig(), ...cfg });
  }, patch);
}

async function stubProviders(app) {
  await app.evaluate((_e, frase) => {
    const P = globalThis.SN_PROVIDERS;
    const risposta = (attempts) => ({
      text: JSON.stringify({ message: frase, suggestions: [] }),
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    P.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const r = risposta(attempts);
      try { onDelta && onDelta(r.text); } catch (_) {}
      return r;
    };
    P.completeWithFallback = async ({ attempts }) => risposta(attempts);
  }, FRASE_DEL_MODELLO);
}

async function conChiave(app, chiave = 'sk-or-vera') {
  await app.evaluate(async (_e, k) => {
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: k } });
  }, chiave);
}

// L'accoglienza è già stata fatta: è lo stato di ogni apertura dopo la prima.
async function accoglienzaGiaFatta(app) {
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    const O = globalThis.SN_ONBOARDING;
    await M.setOnboarding(O.close(O.emptyState(), new Date().toISOString()));
  });
}

async function newtab(app) {
  const scadenza = Date.now() + 10_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => x.url().startsWith('filo://newtab'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('accoglienza già fatta: la configurazione condivisa che arriva dopo toglie il cartello dalla home', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await app.evaluate(() => {
    const Defaults = globalThis.__filoDefaults;
    const orig = globalThis.__filoDefaultsOrigGet || Defaults.get;
    globalThis.__filoDefaultsOrigGet = orig;
    globalThis.__filoConfigArrivata = false;
    Defaults.get = () => (globalThis.__filoConfigArrivata
      ? orig()
      : { ...orig(), models: {}, modelRegistry: {} });
  });
  await conChiave(app);
  await accoglienzaGiaFatta(app);
  await stubProviders(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 15_000 });
  await expect(page.locator('#homeMessage')).toContainText(/nessun modello/i, { timeout: 15_000 });

  await app.evaluate(async () => {
    globalThis.__filoConfigArrivata = true;
    await globalThis.__filoDefaults.refresh().catch(() => {});
  });

  // Niente intervista da far partire: quello che deve cambiare è il messaggio.
  await expect(page.locator('#homeMessage')).not.toContainText(/nessun modello/i, { timeout: 30_000 });
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home');
});

test('accoglienza già fatta: il modello scelto in Opzioni toglie il cartello dalla home', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await configCondivisa(app, { provider: 'gemini', models: {} });
  await conChiave(app);
  await accoglienzaGiaFatta(app);
  await stubProviders(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 15_000 });
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

  await expect(page.locator('#homeMessage')).not.toContainText(/nessun modello/i, { timeout: 30_000 });
});

test('la chiave tolta mentre la home è aperta: la home lo dice, senza ricaricare', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await configCondivisa(app, { provider: 'gemini' });
  await conChiave(app);
  await accoglienzaGiaFatta(app);
  await stubProviders(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 15_000 });
  await expect(page.locator('#homeMessage')).not.toContainText(/codice d.invito/i, { timeout: 20_000 });

  // La chiave si toglie dalla pagina Crediti, con conferma: qui si salva la
  // stessa cosa che salva lei.
  await page.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.UPDATE_SETTINGS,
      settings: { apiKeys: { openrouter: '' } },
    });
  });

  await expect(page.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 30_000 });
});

test('«solo modelli a pesi aperti» acceso mentre la home è aperta: il messaggio cambia da solo', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  const azioni = await app.evaluate(() => {
    const A = globalThis.SN_CONST.ACTIONS;
    return { chat: A.FILO_CHAT, home: A.FILO_DASHBOARD };
  });
  await configCondivisa(app, {
    provider: 'openrouter',
    models: { [azioni.chat]: 'chiuso', [azioni.home]: 'chiuso' },
    modelRegistry: { chiuso: { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' } },
  });
  await conChiave(app);
  await accoglienzaGiaFatta(app);
  await stubProviders(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 15_000 });
  await expect(page.locator('#homeMessage')).not.toContainText(/pesi aperti/i, { timeout: 20_000 });

  await page.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.UPDATE_SETTINGS,
      settings: { openWeightsOnly: true },
    });
  });

  await expect(page.locator('#homeMessage')).toContainText(/pesi aperti/i, { timeout: 30_000 });
});

test('fornitore dichiarato ritirato: la chat della home risponde, non solo l’accoglienza', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await configCondivisa(app, { provider: 'gemini' });
  await conChiave(app);
  await accoglienzaGiaFatta(app);
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    const risposta = (attempts) => ({
      text: JSON.stringify({ text: 'Rispondo eccome.', actions: [] }),
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    P.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const r = risposta(attempts);
      try { onDelta && onDelta(r.text); } catch (_) {}
      return r;
    };
    P.completeWithFallback = async ({ attempts }) => risposta(attempts);
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 15_000 });

  await page.fill('#input', 'ciao');
  await page.press('#input', 'Enter');
  await expect(page.locator('.dash-bubble-filo').last())
    .toContainText('Rispondo eccome', { timeout: 30_000 });
});
