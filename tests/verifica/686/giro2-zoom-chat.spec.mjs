// #686 giro 2 — lo zoom della pagina chiesto a parole.
// Si guarda il risultato dal punto di vista dell'utente: la pagina cambia
// misura, il numero riferito è quello vero, e le strade (chat, tasti, tasto
// destro) raccontano e fanno la stessa cosa.

import { test, expect } from './../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>zoom</title></head>
<body style="font:16px sans-serif;padding:40px"><h1 id="t">una pagina qualunque</h1>
<p id="p">testo da ingrandire</p></body></html>`;

const execAction = (app, action) =>
  app.evaluate(({ BrowserWindow }, { action }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return globalThis.SN_EXECUTE_FILO_ACTION(action, { sender: { win, wc: win.webContents } });
  }, { action });

async function percentOf(app, page) {
  const url = await page.evaluate(() => location.href);
  const f = await app.evaluate(({ webContents }, u) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here === u) return wc.getZoomFactor();
    }
    return null;
  }, url);
  return f == null ? null : Math.round(f * 100);
}

// Apre il menu del tasto destro senza dipendere dalle coordinate (con la
// pagina zoomata un click reale finisce altrove) e ritorna le etichette.
async function vociMenu(page) {
  await page.evaluate(() => {
    const el = document.getElementById('p');
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
  });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 4000 });
  return page.locator('.sn-menu').evaluate((m) => Array.from(m.querySelectorAll('*'))
    .filter((n) => n.children.length === 0 && n.textContent.trim())
    .map((n) => n.textContent.trim()));
}

test('il tasto destro racconta il livello e riporta alla dimensione reale', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);

  // A dimensione reale la voce non c'è: non è uno stato da raccontare.
  const a100 = await vociMenu(page);
  expect(a100.join(' | ')).not.toMatch(/ora\s+\d+%/);
  await page.keyboard.press('Escape');

  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  await expect.poll(async () => percentOf(app, page)).toBe(150);

  const a150 = await vociMenu(page);
  expect(a150.join(' | ')).toMatch(/ora\s+150%/);

  // Cliccarla riporta al 100%: la via d'uscita c'è davvero.
  await page.locator('.sn-menu').getByText(/ora\s+150%/).click();
  await expect.poll(async () => percentOf(app, page)).toBe(100);
});

test('lo zoom chiesto a parole vale anche sulle pagine di Filo', async ({ app, openTab }) => {
  const page = await openTab('filo://history/');
  await page.waitForLoadState('domcontentloaded');
  const r = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  expect(r.executed).toBe(true);
  expect(r.output.percentuale).toBe(150);
  await expect.poll(async () => app.evaluate(({ webContents }) => {
    for (const wc of webContents.getAllWebContents()) {
      let u = ''; try { u = wc.getURL(); } catch (_) {}
      if (u.startsWith('filo://history')) return Math.round(wc.getZoomFactor() * 100);
    }
    return null;
  })).toBe(150);
});

test('lo zoom resta sul sito passando da una pagina all\'altra', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  await expect.poll(async () => percentOf(app, page)).toBe(150);

  const altra = testServer.html(PAGINA.replace('una pagina qualunque', 'seconda pagina'));
  await page.goto(altra);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  expect(await percentOf(app, page)).toBe(150);
});

test('richieste storte non zoomano a caso e non mentono', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  const storte = [
    { percentuale: 0 }, { percentuale: -50 }, { percentuale: 'abc' },
    { percentuale: '🙂' }, { percentuale: '' }, { percentuale: '   ' },
    { verso: 'IN-SU' }, { verso: '' }, {},
  ];
  for (const s of storte) {
    const r = await execAction(app, { type: 'ZOOM_PAGINA', ...s });
    expect(r.executed, JSON.stringify(s)).toBe(false);
    expect(await percentOf(app, page), JSON.stringify(s)).toBe(100);
  }
  // Forme che un umano scrive davvero: devono funzionare.
  for (const [v, atteso] of [['150%', 150], [' 125 ', 125], ['125,0', 125]]) {
    await execAction(app, { type: 'ZOOM_PAGINA', verso: 'reset' });
    const r = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: v });
    expect(r.executed, String(v)).toBe(true);
    expect(await percentOf(app, page), String(v)).toBe(atteso);
  }
});

test('Filo sa a quanto sta lo zoom della scheda davanti', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  await expect.poll(async () => percentOf(app, page)).toBe(150);

  const testo = await app.evaluate(async () => {
    const S = globalThis.SN_FILO_STATE;
    return (await S.assemble()).stateText;
  });
  expect(testo).toMatch(/ZOOM DELLA PAGINA/);
  expect(testo).toMatch(/150%/);

  await execAction(app, { type: 'ZOOM_PAGINA', verso: 'reset' });
  await expect.poll(async () => percentOf(app, page)).toBe(100);
  const dopo = await app.evaluate(async () => {
    const S = globalThis.SN_FILO_STATE;
    return (await S.assemble()).stateText;
  });
  expect(dopo).toMatch(/Scheda davanti: 100%/);
});
