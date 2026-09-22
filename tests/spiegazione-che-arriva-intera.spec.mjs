// #663 — la frase che spiega perché Filo non può rispondere è scritta una
// volta sola e deve arrivare INTERA a ogni superficie, con la strada per
// toglierlo di mezzo. Prima ogni riquadro decideva per conto suo: la chat
// della home la mostrava col tasto «Apri Crediti», il riquadro della
// spiegazione su una pagina web stampava la riga grezza del servizio
// («OpenRouter 402: {…}»), e l'Aiuto nominava la pagina Crediti senza portarci.

import { test, expect } from './fixtures/electron.mjs';

const PAGINA = '<!doctype html><meta charset="utf-8"><title>Pagina</title><p id="p">Una frase con dentro la parola sonda.</p>';

async function configModelli(app, chiave) {
  await app.evaluate(async (_e, k) => {
    const C = globalThis.SN_CONST;
    const D = globalThis.__filoDefaults;
    const orig = globalThis.__filoDefaultsOrigGet || D.get;
    globalThis.__filoDefaultsOrigGet = orig;
    const models = {};
    for (const a of Object.values(C.ACTIONS)) models[a] = 'testo';
    D.get = () => ({
      ...orig(), provider: 'openrouter', models,
      modelRegistry: { testo: { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash-0731' } },
      ...(k ? {} : { apiKeys: {} }),
    });
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: k }, openWeightsOnly: false });
  }, chiave);
}

// Il fornitore risponde 402: i crediti del giorno sono finiti, che capita a
// chiunque usi Filo coi crediti di Filo.
async function creditiFiniti(app) {
  await app.evaluate(async () => {
    const P = globalThis.SN_PROVIDER_OPENROUTER;
    const boom = () => {
      const e = new Error('OpenRouter 402: {"error":{"message":"Insufficient credits"}}');
      e.status = 402; e.provider = 'openrouter';
      throw e;
    };
    globalThis.SN_PROVIDER_OPENROUTER = { ...P, streamComplete: boom, complete: boom };
  });
}

// La strada dell'utente: selezione più la scorciatoia della spiegazione, la
// stessa che aziona il menu del tasto destro. Dalla pagina i moduli di Filo non
// si vedono (vivono nel mondo isolato del preload), quindi il comando arriva
// dal main come glielo manda la scorciatoia vera.
async function chiediSpiegazione(app, page) {
  await page.evaluate(() => {
    const n = document.getElementById('p').firstChild;
    const r = document.createRange();
    r.setStart(n, 26); r.setEnd(n, 31);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await comandoAllaPagina(app, { type: 'shortcut_triggered', command: 'explain-selection' });
}

async function comandoAllaPagina(app, msg) {
  await app.evaluate(({ BrowserWindow }, m) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w._filoTabs) continue;
      for (const t of w._filoTabs.tabs) {
        const wc = t.view.webContents;
        if (!wc.getURL().startsWith('http')) continue;
        wc.mainFrame.send('filo:broadcast', m);
      }
    }
  }, msg);
}

test('crediti finiti: il riquadro della spiegazione lo dice, non mostra la riga grezza del servizio', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await configModelli(app, 'k-test');
  await creditiFiniti(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await chiediSpiegazione(app, page);

  const bolla = page.locator('.sn-popup .sn-msg-assistant .sn-msg-text').last();
  await expect(bolla).toBeVisible({ timeout: 25_000 });
  await expect(bolla).toContainText(/crediti/i, { timeout: 15_000 });
  await expect(bolla).not.toContainText('402');
  await expect(bolla).not.toContainText(/insufficient/i);
  // La frase nomina la pagina Crediti: da un sito qualunque ci si deve poter
  // andare, come fa la chat della home.
  await expect(page.locator('.sn-popup .sn-msg-rimedio')).toBeVisible({ timeout: 10_000 });
});

test('nessuna chiave: il riquadro della spiegazione dice cosa manca e porta ai Crediti', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await configModelli(app, '');
  const page = await testServer.openReady(openTab, PAGINA);
  await chiediSpiegazione(app, page);

  const bolla = page.locator('.sn-popup .sn-msg-assistant .sn-msg-text').last();
  await expect(bolla).toBeVisible({ timeout: 25_000 });
  await expect(bolla).toContainText(/invito|crediti/i, { timeout: 15_000 });

  // Il tasto non descrive il problema: lo toglie. Cliccarlo apre la pagina.
  const via = page.locator('.sn-popup .sn-msg-rimedio');
  await expect(via).toBeVisible({ timeout: 10_000 });
  await via.click();
  await expect.poll(
    () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .flatMap((w) => (w._filoTabs ? w._filoTabs.tabs : []))
      .map((t) => t.view.webContents.getURL())
      .some((u) => u.startsWith('filo://credits'))),
    { timeout: 15_000 },
  ).toBe(true);
});

test('senza chiave, l’Aiuto su una pagina web dice cosa manca e porta ai Crediti', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await configModelli(app, '');
  const page = await testServer.openReady(openTab, PAGINA);
  await comandoAllaPagina(app, { type: 'top_frame_command', surface: 'help' });
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 20_000 });
  await page.fill('.sn-sidebar-input textarea', 'cosa posso fare qui?');
  await page.press('.sn-sidebar-input textarea', 'Enter');

  const bolla = page.locator('.sn-sidebar-msg-error').last();
  await expect(bolla).toBeVisible({ timeout: 30_000 });
  await expect(bolla).toContainText(/invito|crediti/i, { timeout: 15_000 });

  const via = page.locator('.sn-sidebar-choice').filter({ hasText: /crediti/i });
  await expect(via.first()).toBeVisible({ timeout: 10_000 });
  await via.first().click();
  await expect.poll(
    () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .flatMap((w) => (w._filoTabs ? w._filoTabs.tabs : []))
      .map((t) => t.view.webContents.getURL())
      .some((u) => u.startsWith('filo://credits'))),
    { timeout: 15_000 },
  ).toBe(true);
});
