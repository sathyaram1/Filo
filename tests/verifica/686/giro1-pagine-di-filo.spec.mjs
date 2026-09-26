// #686, primo giro — LE PAGINE DI FILO VALGONO QUANTO UN SITO.
//
// Il manifesto delle capacità promette lo zoom «sia sui siti sia sulle pagine di
// Filo (home, impostazioni, cronologia…)», e che quando la pagina non è al 100%
// il tasto destro mostra il livello e riporta alla dimensione reale. La home è
// anche il posto da cui si scrive a Filo: chiedere «ingrandisci la pagina»
// mentre si guarda la home è il caso più normale che esista.
//
// Qui si prova quel cammino: la pagina interna si ingrandisce davvero, Filo sa
// dire a quanto sta, e il tasto destro offre la via d'uscita come sui siti.

import { test, expect } from '../../fixtures/electron.mjs';

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

test('la cronologia di Filo si ingrandisce a parole, e Filo sa dire a quanto sta', async ({ app, openTab }) => {
  const page = await openTab('filo://history/history.html');
  await page.waitForLoadState('domcontentloaded');
  expect(await percentOf(app, page)).toBe(100);

  const r = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  expect(r.executed, 'una pagina di Filo si zooma come un sito').toBe(true);
  expect(r.output.percentuale).toBe(150);
  await expect.poll(async () => percentOf(app, page)).toBe(150);

  // Il livello entra nel contesto della chat anche per una pagina di Filo.
  const stato = await app.evaluate(async () => (await globalThis.SN_FILO_STATE.assemble()).stateText);
  expect(stato).toMatch(/Scheda davanti: 150%/);

  // …e il passo indietro riporta dove si era.
  const reset = await execAction(app, { type: 'ZOOM_PAGINA', verso: 'reset' });
  expect(reset.output.percentuale).toBe(100);
  await expect.poll(async () => percentOf(app, page)).toBe(100);
});

test('la home — dove si scrive a Filo — si ingrandisce a parole', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForLoadState('domcontentloaded');

  const r = await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 125 });
  expect(r.executed, 'la home si zooma come un sito').toBe(true);
  expect(r.output.percentuale).toBe(125);
  await expect.poll(async () => percentOf(app, page)).toBe(125);
});

test('tasto destro su una pagina di Filo zoomata: il livello si vede e riporta alla dimensione reale', async ({ app, openTab }) => {
  const page = await openTab('filo://history/history.html');
  await page.waitForLoadState('domcontentloaded');

  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  await expect.poll(async () => percentOf(app, page)).toBe(150);

  await page.locator('body').click({ button: 'right', position: { x: 12, y: 12 } });
  const menu = page.locator('.sn-menu').first();
  await expect(menu, 'il tasto destro apre il menu di Filo anche sulle sue pagine').toBeVisible();
  const voce = menu.getByText(/Dimensione reale \(ora 150%\)/);
  await expect(voce, 'il livello si vede nel tasto destro come sui siti').toBeVisible();

  await voce.click();
  await expect.poll(async () => percentOf(app, page)).toBe(100);
});
