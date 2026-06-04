// Comandi slash della dashboard + risoluzione della finestra principale.
//
// Feedback alpha #4: dopo aver chiuso una tab (o comunque dopo che è apparso
// un tooltip), comandi come /newtab o /modelli smettevano di funzionare mentre
// /kill continuava. Causa: i tooltip/popup sono BrowserWindow figlie (parent:
// mainWindow) e in Electron 33 si inseriscono in TESTA a getAllWindows(), così
// getAllWindows()[0] non era più la finestra con i tab. Il fix risolve la
// finestra cercando quella che possiede _filoTabs.
//
// Feedback alpha #0: aggiunti i comandi /sicurezza /preferenze /editor /feedback.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata entro 10s').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  return win;
}

// URL di tutti i tab della finestra principale (letti dal main process).
async function tabUrls(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    return w ? w._filoTabs.tabs.map((t) => t.url) : [];
  });
}

// Riproduce la pre-condizione del bug: crea una finestra figlia (come fanno
// tooltip e popup-menu) e verifica che getAllWindows()[0] non possieda più i
// tab — esattamente lo stato in cui il vecchio codice falliva.
async function spawnChildWindow(app) {
  const zeroHasTabs = await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    new BrowserWindow({ parent: main, show: false, focusable: false });
    return !!BrowserWindow.getAllWindows()[0]._filoTabs;
  });
  expect(zeroHasTabs, 'pre-condizione: [0] non deve avere _filoTabs').toBe(false);
}

async function runSlash(page, command) {
  await page.evaluate((cmd) => {
    const input = document.getElementById('input');
    const form = document.getElementById('inputForm');
    input.value = cmd;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, command);
}

test('un comando slash apre un tab anche con una finestra figlia presente (#4)', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  const before = (await tabUrls(app)).length;
  await spawnChildWindow(app);

  await runSlash(page, '/newtab');

  // Senza il fix il comando è un no-op: il conteggio resta invariato.
  await expect
    .poll(async () => (await tabUrls(app)).length, { timeout: 8_000 })
    .toBe(before + 1);
});

test('"/clear all" chiude tutte le schede e lascia una sola newtab', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  // Apri qualche scheda extra, così "tutte" è davvero > 1.
  await runSlash(page, '/sicurezza');
  await runSlash(page, '/preferenze');
  await expect
    .poll(async () => (await tabUrls(app)).length, { timeout: 8_000 })
    .toBeGreaterThanOrEqual(3);

  await runSlash(page, '/clear all');

  // Tutte chiuse → resta una sola scheda, ed è una newtab fresca.
  await expect
    .poll(async () => (await tabUrls(app)).length, { timeout: 8_000 })
    .toBe(1);
  const urls = await tabUrls(app);
  expect(urls[0].startsWith('filo://newtab')).toBe(true);
});

test('i nuovi comandi /sicurezza /preferenze /editor /feedback aprono le pagine giuste (#0)', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  // Anche con la finestra figlia presente i comandi devono funzionare.
  await spawnChildWindow(app);

  const cases = [
    ['/sicurezza', 'filo://security/'],
    ['/preferenze', 'filo://preferences/'],
    ['/editor', 'filo://editor/'],
    ['/feedback', 'filo://feedback/'],
  ];

  for (const [cmd, urlPrefix] of cases) {
    await runSlash(page, cmd);
    await expect
      .poll(async () => (await tabUrls(app)).some((u) => u.startsWith(urlPrefix)), { timeout: 8_000 })
      .toBe(true);
  }
});
