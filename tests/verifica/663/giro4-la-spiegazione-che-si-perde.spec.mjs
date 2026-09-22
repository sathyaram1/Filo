// Verifica #663, giro 4 — la spiegazione già scritta non deve perdersi per
// strada, e la home deve accorgersi anche quando cambia SOLO il perché.
//
// Il giro 3 ha chiesto che chi scrive nella barra, e non legge il messaggio
// sopra, riceva la spiegazione vera invece di «Qualcosa è andato storto» —
// nominando due posti: la chat della home E il riquadro dell'Aiuto su una
// pagina web, «che non ha nient'altro da leggere». Qui si prova il secondo.
//
// I giri 1-3 hanno chiuso le porte in cui la home si accorge che Filo può (o
// non può più) rispondere, e quella in cui cambia il motivo mentre i crediti
// arrivano. Resta il motivo che cambia passando dalle Opzioni, cioè dal posto
// dove la home stessa manda l'utente.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = '<!doctype html><meta charset="utf-8"><title>Pagina qualunque</title><p>Contenuto.</p>';

async function configCondivisa(app, patch) {
  await app.evaluate(async (_electron, cfg) => {
    const Defaults = globalThis.__filoDefaults;
    const orig = globalThis.__filoDefaultsOrigGet || Defaults.get;
    globalThis.__filoDefaultsOrigGet = orig;
    Defaults.get = () => ({ ...orig(), ...cfg });
  }, patch);
}

async function azioni(page) {
  return page.evaluate(() => {
    const A = window.SN_CONST.ACTIONS;
    return { chat: A.FILO_CHAT, home: A.FILO_DASHBOARD, aiuto: A.HELP };
  });
}

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

// Il motivo che Filo si dà adesso, letto dal main: serve a distinguere «la
// home è ferma» da «lo stato non è cambiato davvero».
async function motivoOra(app) {
  return app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const A = C.ACTIONS;
    const s = await globalThis.__filoHandlers.getEffectiveSettings();
    return C.whyCannotServe(s, [A.FILO_DASHBOARD, A.FILO_CHAT]);
  });
}

// Apre l'Aiuto su una pagina web vera, scrive e manda. Su una pagina esterna i
// moduli di Filo vivono nel mondo isolato del preload e da qui non si vedono:
// l'Aiuto si apre con lo stesso comando di pagina che gli manda il menu del
// tasto destro, cioè la strada dell'utente.
async function apriAiuto(app, page) {
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w._filoTabs) continue;
      for (const t of w._filoTabs.tabs) {
        const wc = t.view.webContents;
        if (!wc.getURL().startsWith('http')) continue;
        wc.mainFrame.send('filo:broadcast', { type: 'top_frame_command', surface: 'help' });
      }
    }
  });
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 20_000 });
}

async function chiediAllAiuto(app, page, testo) {
  await apriAiuto(app, page);
  await page.fill('.sn-sidebar-input textarea', testo);
  await page.press('.sn-sidebar-input textarea', 'Enter');
}

test('«solo pesi aperti» esclude tutto: l’Aiuto su una pagina web spiega, non dice «qualcosa è andato storto»', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const scheda = await openTab('filo://newtab/');
  const a = await azioni(scheda);
  await app.evaluate(async (_e, act) => {
    const D = globalThis.__filoDefaults;
    const orig = globalThis.__filoDefaultsOrigGet || D.get;
    globalThis.__filoDefaultsOrigGet = orig;
    D.get = () => ({
      ...orig(),
      provider: 'openrouter',
      models: { [act.chat]: 'chiuso', [act.home]: 'chiuso', [act.aiuto]: 'chiuso' },
      modelRegistry: { chiuso: { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' } },
    });
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'k-test' }, openWeightsOnly: true });
  }, a);

  const page = await testServer.openReady(openTab, PAGINA);
  await chiediAllAiuto(app, page, 'cosa posso fare qui?');

  const bolla = page.locator('.sn-sidebar-msg-error').last();
  await expect(bolla).toBeVisible({ timeout: 30_000 });
  // La spiegazione giusta Filo ce l'ha già pronta: deve arrivare intera.
  await expect(bolla).toContainText(/pesi aperti/i, { timeout: 15_000 });
  await expect(bolla).not.toContainText(/qualcosa è andato storto/i);
});

test('nessuna chiave da nessuna parte: l’Aiuto su una pagina web dice cosa manca', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const scheda = await openTab('filo://newtab/');
  const a = await azioni(scheda);
  await app.evaluate(async (_e, act) => {
    const D = globalThis.__filoDefaults;
    const orig = globalThis.__filoDefaultsOrigGet || D.get;
    globalThis.__filoDefaultsOrigGet = orig;
    D.get = () => ({
      ...orig(),
      provider: 'openrouter',
      models: { [act.chat]: 'testo', [act.home]: 'testo', [act.aiuto]: 'testo' },
      modelRegistry: { testo: { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash-0731' } },
      apiKeys: {},
    });
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: '' }, openWeightsOnly: false });
  }, a);

  const page = await testServer.openReady(openTab, PAGINA);
  await chiediAllAiuto(app, page, 'cosa posso fare qui?');

  const bolla = page.locator('.sn-sidebar-msg-error').last();
  await expect(bolla).toBeVisible({ timeout: 30_000 });
  await expect(bolla).toContainText(/invito|crediti/i, { timeout: 15_000 });
  await expect(bolla).not.toContainText(/qualcosa è andato storto/i);
});

test('cambia solo il motivo passando dalle Opzioni: la home aperta smette di incolpare l’interruttore', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  const a = await azioni(page);
  await accoglienzaGiaFatta(app);
  await configCondivisa(app, {
    provider: 'openrouter',
    models: { [a.chat]: 'chiuso', [a.home]: 'chiuso' },
    modelRegistry: { chiuso: { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' } },
  });
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'k-test' }, openWeightsOnly: true });
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#homeMessage')).toContainText(/pesi aperti/i, { timeout: 30_000 });

  // L'utente va in Opzioni — dove la home stessa lo manda — e invece di
  // spegnere l'interruttore spegne «usa i modelli predefiniti», senza averne
  // scelti di suoi. L'interruttore non c'entra più niente: adesso a mancare
  // sono i modelli, e la home continua a dare la colpa all'interruttore.
  await page.evaluate(async () => {
    const vuoti = {};
    for (const a of Object.values(window.SN_CONST.ACTIONS)) vuoti[a] = '';
    await chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.UPDATE_SETTINGS,
      settings: { useDefaultModels: false, models: vuoti },
    });
  });

  expect(await motivoOra(app)).toBe('modelli'); // lo stato è cambiato davvero
  await expect(page.locator('#homeMessage')).not.toContainText(/pesi aperti/i, { timeout: 30_000 });
  await expect(page.locator('#homeMessage')).toContainText(/nessun modello/i, { timeout: 30_000 });
});

test('scelto il modello che la home chiedeva, la home smette di chiederlo', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  const a = await azioni(page);
  await accoglienzaGiaFatta(app);
  await configCondivisa(app, { provider: 'openrouter', models: {}, modelRegistry: {} });
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'k-test' }, openWeightsOnly: true });
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#homeMessage')).toContainText(/nessun modello/i, { timeout: 30_000 });

  // L'utente fa quello che la home gli dice: sceglie un modello in Opzioni.
  // È proprietario e l'interruttore lo esclude, quindi Filo resta muto — ma
  // adesso il motivo è un altro, e la home deve smettere di chiedere una cosa
  // che l'utente ha appena fatto.
  await page.evaluate(async () => {
    const A = window.SN_CONST.ACTIONS;
    const vuoti = {};
    for (const a of Object.values(A)) vuoti[a] = '';
    await chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.UPDATE_SETTINGS,
      settings: {
        useDefaultModels: false,
        modelRegistry: { chiuso: { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' } },
        models: { ...vuoti, [A.FILO_CHAT]: 'chiuso', [A.FILO_DASHBOARD]: 'chiuso' },
      },
    });
  });

  expect(await motivoOra(app)).toBe('pesi-aperti'); // lo stato è cambiato davvero
  await expect(page.locator('#homeMessage')).toContainText(/pesi aperti/i, { timeout: 30_000 });
});
