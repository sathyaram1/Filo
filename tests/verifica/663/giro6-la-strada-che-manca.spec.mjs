// Verifica #663, giro 6 — la frase già scritta per l'utente arriva, e da dove
// la strada per togliere l'ostacolo è stata messa (l'Aiuto su una pagina web,
// il riquadro della spiegazione) deve APRIRSI davvero la pagina Crediti:
// esserci non basta. Le superfici rimaste senza strada viaggiano nel #663.2.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = '<!doctype html><meta charset="utf-8"><title>Pagina</title>'
  + '<p id="p">Una frase con dentro la parola sonda.</p>';

async function configModelli(app, { chiave }) {
  await app.evaluate(async (_e, cfg) => {
    const C = globalThis.SN_CONST;
    const D = globalThis.__filoDefaults;
    const orig = globalThis.__filoDefaultsOrigGet || D.get;
    globalThis.__filoDefaultsOrigGet = orig;
    const models = {};
    for (const a of Object.values(C.ACTIONS)) models[a] = 'testo';
    D.get = () => ({
      ...orig(), provider: 'openrouter', models,
      modelRegistry: { testo: { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash-0731' } },
      ...(cfg.chiave ? {} : { apiKeys: {} }),
    });
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: cfg.chiave }, openWeightsOnly: false });
  }, { chiave });
}

// I crediti del giorno finiti: quello che capita a tutti, prima o poi.
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

// La pagina Crediti si è aperta davvero in una scheda? È l'unica cosa che
// conta per chi sta su un sito qualunque: un tasto che non porta da nessuna
// parte vale quanto la frase da sola.
async function creditiAperta(app) {
  return app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w._filoTabs) continue;
      for (const t of w._filoTabs.tabs) {
        if (String(t.view.webContents.getURL()).includes('credits')) return true;
      }
    }
    return false;
  });
}

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

async function chiediSpiegazione(app, page) {
  await page.evaluate(() => {
    const n = document.getElementById('p').firstChild;
    const r = document.createRange();
    r.setStart(n, 26); r.setEnd(n, 31);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w._filoTabs) continue;
      for (const t of w._filoTabs.tabs) {
        const wc = t.view.webContents;
        if (!wc.getURL().startsWith('http')) continue;
        wc.mainFrame.send('filo:broadcast', { type: 'shortcut_triggered', command: 'explain-selection' });
      }
    }
  });
}

test('senza chiave, il tasto dell’Aiuto apre davvero la pagina Crediti', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await configModelli(app, { chiave: '' });
  const page = await testServer.openReady(openTab, PAGINA);
  await apriAiuto(app, page);
  await page.fill('.sn-sidebar-input textarea', 'cosa posso fare qui?');
  await page.press('.sn-sidebar-input textarea', 'Enter');

  const strada = page.locator('.sn-sidebar button, .sn-sidebar a').filter({ hasText: /crediti/i }).first();
  await expect(strada).toBeVisible({ timeout: 30_000 });
  await strada.click();
  await expect.poll(() => creditiAperta(app), { timeout: 20_000 }).toBe(true);
});

test('crediti finiti, il tasto del riquadro della spiegazione apre davvero la pagina Crediti', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await configModelli(app, { chiave: 'k-test' });
  await creditiFiniti(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await chiediSpiegazione(app, page);

  const strada = page.locator('.sn-popup button').filter({ hasText: /crediti/i }).first();
  await expect(strada).toBeVisible({ timeout: 30_000 });
  await strada.click();
  await expect.poll(() => creditiAperta(app), { timeout: 20_000 }).toBe(true);
});
