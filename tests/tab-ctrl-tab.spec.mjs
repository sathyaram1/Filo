// #590.14 — Ctrl+Tab e Ctrl+Shift+Tab cambiano scheda come in ogni browser: dalla pagina anche mentre si scrive,
// dalla fila delle schede, dalla barra laterale aperta da tastiera e da una pagina di Filo. Regola: src/shared/tasti.js.

import { test, expect } from './fixtures/electron.mjs';
import { barraPage, statoBarra, pannelloFermo, premi } from './helpers/barra.mjs';

const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return { ids: w._filoTabs.tabs.map((t) => t.id), attiva: w._filoTabs.activeId };
});
const attiva = async (app) => (await schede(app)).attiva;

async function treSchede(openTab, testServer) {
  await openTab(testServer.html('<!doctype html><title>UNO</title><h1>1</h1>'));
  await openTab(testServer.html('<!doctype html><title>DUE</title><h1>2</h1>'));
  return openTab(testServer.html('<!doctype html><title>TRE</title><input id="q">'));
}

test('Ctrl+Tab mentre si scrive in una pagina porta alla scheda dopo, Ctrl+Shift+Tab a quella prima, in tondo', async ({ app, openTab, testServer }) => {
  const tre = await treSchede(openTab, testServer);
  await tre.evaluate(() => {
    window.__tabVisti = 0;
    addEventListener('keydown', (e) => { if (e.key === 'Tab') window.__tabVisti++; }, true);
  });
  await tre.locator('#q').click();
  await tre.keyboard.type('ciao');
  const { ids, attiva: qui } = await schede(app);
  expect(qui).toBe(ids[ids.length - 1]);

  // Dall'ultima scheda si riparte dalla prima.
  await premi(app, 'tab', 'Tab', ['control']);
  await expect.poll(() => attiva(app)).toBe(ids[0]);
  // E dalla prima, all'indietro, si torna all'ultima: la tastiera la segue, quindi il tasto parte da lì.
  await premi(app, 'tab', 'Tab', ['control', 'shift']);
  await expect.poll(() => attiva(app)).toBe(qui);
  await premi(app, 'tab', 'Tab', ['control', 'shift']);
  await expect.poll(() => attiva(app)).toBe(ids[ids.length - 2]);
  await premi(app, 'tab', 'Tab', ['control']);
  await expect.poll(() => attiva(app)).toBe(qui);

  // Il Tab non è arrivato alla pagina: il testo scritto è intatto e nessun campo ha perso il fuoco per lui.
  expect(await tre.evaluate(() => window.__tabVisti)).toBe(0);
  await expect(tre.locator('#q')).toHaveValue('ciao');
});

test('Ctrl+Tab col fuoco sulla fila delle schede cambia scheda', async ({ app, openTab, testServer }) => {
  await treSchede(openTab, testServer);
  const { ids } = await schede(app);
  await premi(app, 'shell', 'Tab', ['control']);
  await expect.poll(() => attiva(app)).toBe(ids[0]);
  await premi(app, 'shell', 'Tab', ['control', 'shift']);
  await expect.poll(() => attiva(app)).toBe(ids[ids.length - 1]);
});

test('barra laterale aperta da tastiera: Ctrl+Shift+Tab porta alla scheda prima e la barra si chiude', async ({ app, openTab, testServer }) => {
  const tre = await treSchede(openTab, testServer);
  await tre.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  const { ids } = await schede(app);
  const barra = await barraPage(app);
  await premi(app, 'tab', 'B', ['control', 'shift']);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await pannelloFermo(barra);
  await premi(app, 'barra', 'Tab', ['control', 'shift']);
  await expect.poll(() => attiva(app)).toBe(ids[ids.length - 2]);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(false);
});

test('Opzioni → Altro elenca Ctrl+Tab e Ctrl+Shift+Tab, e da lì funzionano', async ({ app, openTab, testServer }) => {
  await openTab(testServer.html('<!doctype html><title>UNO</title><h1>1</h1>'));
  const altro = await openTab('filo://options/altro.html');
  const elenco = altro.locator('#shortcutsList');
  await expect(elenco).toContainText('Ctrl+Tab — Vai alla scheda successiva');
  await expect(elenco).toContainText('Ctrl+Shift+Tab — Vai alla scheda precedente');
  const { ids, attiva: qui } = await schede(app);
  await premi(app, 'tab', 'Tab', ['control', 'shift']);
  await expect.poll(() => attiva(app)).toBe(ids[ids.indexOf(qui) - 1]);
});
