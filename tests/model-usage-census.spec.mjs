// Censimento dei punti in cui Filo usa un modello (#417).
//
// L'unit test verifica che l'elenco sia completo e che nessun punto prenda il
// modello da un valore scritto nel codice. Qui si verifica il COMPORTAMENTO
// dell'app, cioè le due cose che l'utente può fare grazie al censimento:
//
//  1. i punti che prima non erano impostabili ORA lo sono davvero: nelle
//     Opzioni compare un campo per ciascuno, e il valore scritto lì finisce
//     nella configurazione (e viene riletto al reload);
//  2. i punti che NON si impostano da lì (giudici e sanificatore, che girano
//     sui server di Filo) e quelli che un modello non lo usano affatto sono
//     comunque ELENCATI, con scritto dove si impostano: è la parte "leggibile"
//     del censimento;
//  3. l'editor chiede il titolo del documento con la SUA funzione, non
//     prendendo in prestito quella di «Spiega» come faceva prima.

import { test, expect } from './fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';

async function revealAdvanced(page) {
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  await page.uncheck('#useDefaultModels');
  await page.waitForSelector('#modelsGrid .sn-chain', { timeout: 4_000 });
}

test('ogni punto censito come impostabile ha davvero un campo nelle Opzioni', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await revealAdvanced(page);

  // La griglia ha una cella per OGNI funzione del censimento, nello stesso
  // ordine: se una funzione mancasse, non ci sarebbe posto dove impostarla.
  const expected = await page.evaluate(() => window.SN_MODEL_USAGE.userActions());
  expect(expected.length).toBeGreaterThan(30);
  const cells = await page.locator('#modelsGrid .sn-chain').count();
  expect(cells).toBe(expected.length);

  // Fra queste ci sono i punti che prima erano invisibili: l'indicizzazione
  // dell'archivio (il modello era scritto nel codice) e le tre funzioni
  // dell'editor (prendevano in prestito il modello di «Spiega»).
  const A = await page.evaluate(() => window.SN_CONST.ACTIONS);
  for (const action of [A.ARCHIVE_EMBED, A.EDITOR_TITLE, A.EDITOR_SUMMARY, A.EDITOR_CHAT,
    A.MANAGE_SEARCH, A.PROVIDER_TEST]) {
    expect(expected).toContain(action);
  }
});

test('impostare il modello dell\'indicizzazione lo salva e lo ripropone', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await revealAdvanced(page);

  const idx = await page.evaluate(() =>
    window.SN_MODEL_USAGE.userActions().indexOf(window.SN_CONST.ACTIONS.ARCHIVE_EMBED));
  expect(idx).toBeGreaterThanOrEqual(0);

  const input = page.locator('#modelsGrid .sn-chain').nth(idx).locator('.sn-chain-input').first();
  // Precondizione: parte dal modello di indicizzazione predefinito.
  await expect(input).toHaveValue('embed-004');

  await input.fill('mio-indicizzatore');
  await input.blur();
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  const saved = await page.evaluate(async () => {
    const s = await window.SN_STORAGE.getSettings();
    return s.models[window.SN_CONST.ACTIONS.ARCHIVE_EMBED];
  });
  expect(saved).toBe('mio-indicizzatore');

  await page.reload();
  await page.waitForSelector('#modelsGrid .sn-chain', { timeout: 8_000 });
  await expect(
    page.locator('#modelsGrid .sn-chain').nth(idx).locator('.sn-chain-input').first(),
  ).toHaveValue('mio-indicizzatore');
});

test('gli altri punti (giudici, sanificatore, punti senza modello) sono elencati con il loro "dove"', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await revealAdvanced(page);

  const list = page.locator('#modelUsageList');
  await expect(list).toBeVisible();

  const rows = await list.locator('.sn-usage-row').allTextContents();
  const joined = rows.join('\n');

  // I punti che girano sui server di Filo compaiono, con scritto che li imposta
  // chi gestisce Filo (prima non comparivano da nessuna parte).
  expect(joined).toContain('Sanificatore dei feedback');
  expect(joined).toContain('Giudice 1 dei feedback');
  expect(joined).toContain('Giudice della priorità dei feedback');
  const sanitizerRow = list.locator('.sn-usage-row', { hasText: 'Sanificatore dei feedback' });
  await expect(sanitizerRow.locator('.sn-usage-where')).toHaveText('Lo imposta chi gestisce Filo');

  // I punti che un modello NON lo usano sono elencati apposta, così non si
  // continua a cercare dove impostarlo.
  const cmdRow = list.locator('.sn-usage-row', { hasText: 'Livello di sicurezza di un comando' });
  await expect(cmdRow.locator('.sn-usage-where')).toHaveText('Non usa nessun modello');

  // L'elenco non ripete le funzioni che sono già impostabili nella griglia
  // sopra: quelle si vedono e si modificano lì.
  expect(joined).not.toContain('Chat con Filo');

  // Numero di righe = i punti non-utente del censimento (nessuno perso).
  const expectedRows = await page.evaluate(() =>
    window.SN_MODEL_USAGE.list().filter((e) => e.from !== 'user').length);
  await expect(list.locator('.sn-usage-row')).toHaveCount(expectedRows);
});

test('il pulsante «Prova» usa il modello configurato, e cambia se cambio la configurazione', async ({ app, openTab }) => {
  // Il campo "Prova di un fornitore" delle Opzioni decide con quale modello si
  // misura una chiave. Prima era un nome scritto nel codice: si provava sempre
  // lo stesso, qualunque cosa l'utente avesse impostato.
  const page = await openTab(OPTIONS_URL);
  await revealAdvanced(page);

  // Registro con due modelli riconoscibili e la funzione «Prova di un
  // fornitore» impostata su entrambi: la prova parte sul PRIMO della catena.
  await page.evaluate(async () => {
    const s = await window.SN_STORAGE.getSettings();
    s.useDefaultModels = false;
    s.modelRegistry = {
      ...s.modelRegistry,
      'prova-g': { label: 'Prova uno', provider: 'openrouter', model: 'vendor/modello-di-prova-uno' },
      'prova-o': { label: 'Prova due', provider: 'openrouter', model: 'vendor/modello-di-prova-due' },
    };
    s.models = { ...s.models, [window.SN_CONST.ACTIONS.PROVIDER_TEST]: 'prova-g, prova-o' };
    // Chiavi NON ancora salvate: è il caso vero del pulsante «Prova», che serve
    // proprio a misurare una chiave appena digitata.
    s.apiKeys = { ...s.apiKeys, openrouter: '' };
    await window.SN_STORAGE.setSettings(s);
  });

  // Intercetta la chiamata nel processo principale: ci interessa CON QUALE
  // modello parte la prova, non la risposta del servizio.
  const askedFor = async (provider) => app.evaluate(async ({ }, prov) => {
    const P = globalThis.SN_PROVIDERS;
    const orig = P.streamComplete;
    let seen = null;
    P.streamComplete = async ({ model, onDelta }) => {
      seen = model;
      if (onDelta) onDelta('1, 2, 3');
      return { usage: { completionTokens: 3 } };
    };
    try {
      await globalThis.SN_HANDLE_MESSAGE(
        { type: globalThis.SN_MSG.MSG.TEST_PROVIDER, provider: prov, apiKey: 'chiave-finta' },
        { url: 'filo://options/options.html' },
      );
    } finally { P.streamComplete = orig; }
    return seen;
  }, provider);

  expect(await askedFor('openrouter')).toBe('vendor/modello-di-prova-uno');

  // Cambio la configurazione → cambia il modello con cui si prova.
  await page.evaluate(async () => {
    const s = await window.SN_STORAGE.getSettings();
    s.modelRegistry['prova-g'].model = 'vendor/altro-modello';
    await window.SN_STORAGE.setSettings(s);
  });
  expect(await askedFor('openrouter')).toBe('vendor/altro-modello');
});

test('l\'editor genera il titolo con la sua funzione, non con quella di «Spiega»', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');

  await page.evaluate(() => {
    const MSG = (window.SN_MSG && window.SN_MSG.MSG) || {};
    const orig = window.chrome.runtime.sendMessage.bind(window.chrome.runtime);
    window.__aiCalls = [];
    window.chrome.runtime.sendMessage = (msg, cb) => {
      let r = null;
      if (msg && msg.type === MSG.AI_REQUEST) {
        window.__aiCalls.push(msg.action);
        r = { ok: true, text: 'Il giardino in primavera' };
      } else if (msg && msg.type === MSG.FILO_GET_MEMORY) {
        r = { ok: true, memory: { PROFILO: '', PREFERENZE: '' } };
      }
      if (r) {
        if (typeof cb === 'function') { cb(r); return undefined; }
        return Promise.resolve(r);
      }
      return orig(msg, cb);
    };
  });

  const words = [];
  for (let i = 0; i < 130; i++) words.push(['il', 'giardino', 'in', 'primavera', 'fiorisce'][i % 5]);
  await page.evaluate((txt) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>' + txt + '</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, words.join(' '));

  // Il titolo arriva davvero (la funzione funziona), e la richiesta è partita
  // con la funzione dell'editor: cambiare il modello di «Spiega» non tocca più
  // il titolo del documento, e viceversa.
  await expect(page.locator('#docTitle')).toHaveText('Il giardino in primavera', { timeout: 15_000 });
  const calls = await page.evaluate(() => window.__aiCalls);
  expect(calls).toContain('editor_title');
  expect(calls).not.toContain('explain');
});
