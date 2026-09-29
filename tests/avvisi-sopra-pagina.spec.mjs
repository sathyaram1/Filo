// #588.5 — Gli avvisi della barra in basso a destra si vedono SOPRA la pagina aperta. La pila della
// shell sta sotto la scheda (vista nativa): a schermo la disegna una vista in cima alle altre, e i
// suoi pulsanti devono fare quello che facevano nella shell.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

const FILE = Buffer.from('%PDF-1.4\n% finto pdf di prova\n' + 'x'.repeat(2048));

// Dov'è la vista rispetto alla scheda attiva, e se è l'ultima delle viste (quindi disegnata sopra).
function posa(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tm = win._filoTabs;
    const v = tm.avvisi.vista;
    const tab = tm.tabs.find((t) => t.id === tm.activeId);
    const figli = win.contentView.children;
    const [W, H] = win.getContentSize();
    return {
      inCima: !!v && figli[figli.length - 1] === v,
      vista: v ? v.getBounds() : null,
      scheda: tab ? tab.view.getBounds() : null,
      schede: tm.tabs.length,
      W,
      H,
    };
  });
}

test('l’avviso di fine scaricamento compare sopra la pagina e «Apri cartella» risponde', async ({ app, shell, openTab, testServer, avvisi }) => {
  const fileServer = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': FILE.length,
      'Content-Disposition': 'attachment; filename="report.pdf"',
    });
    res.end(FILE);
  });
  await new Promise((r) => fileServer.listen(0, '127.0.0.1', r));
  const fileUrl = `http://127.0.0.1:${fileServer.address().port}/report.pdf`;
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <a id="dl" href="${fileUrl}">Scarica il report</a></body></html>`);
    await app.evaluate(({ shell: sh }) => {
      globalThis.__cartelle = [];
      sh.showItemInFolder = (p) => { globalThis.__cartelle.push(p); };
    });

    await page.locator('#dl').click();

    const vista = await avvisi();
    await expect(vista.locator('.shell-notif.show .shell-notif-msg')).toHaveText('Scaricato: report.pdf', { timeout: 15_000 });
    await expect(vista.locator('.shell-notif-action', { hasText: 'Apri file' })).toBeVisible();
    await expect(vista.locator('.shell-notif-action', { hasText: 'Apri cartella' })).toBeVisible();

    // In cima alle viste, nell'angolo in basso a destra dell'area della pagina, e la carta ci sta intera.
    await expect.poll(async () => (await posa(app)).inCima).toBe(true);
    const p = await posa(app);
    expect(p.vista.x + p.vista.width).toBe(p.W);
    expect(p.vista.y + p.vista.height).toBe(p.H);
    expect(p.vista.y).toBeGreaterThanOrEqual(p.scheda.y);
    expect(p.vista.x).toBeGreaterThanOrEqual(p.scheda.x);
    const fuori = await vista.evaluate(() => {
      const r = document.querySelector('.shell-notif').getBoundingClientRect();
      return r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight || r.width < 100;
    });
    expect(fuori).toBe(false);

    await vista.locator('.shell-notif-action', { hasText: 'Apri cartella' }).click();
    await expect.poll(() => app.evaluate(() => globalThis.__cartelle.length)).toBe(1);
    expect(await app.evaluate(() => globalThis.__cartelle[0])).toContain('report.pdf');

    // Usata l'azione, l'avviso se ne va e la vista smette di coprire la pagina.
    await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });
    await expect.poll(async () => (await posa(app)).vista.width).toBe(0);
  } finally {
    await new Promise((r) => fileServer.close(r));
  }
});

test('un avviso resta sopra anche alla scheda aperta dopo, segue il tema e la X lo chiude', async ({ app, shell, openTab, testServer, avvisi }) => {
  await testServer.openReady(openTab, '<!doctype html><html><body><p>prima</p></body></html>');
  await shell.evaluate(() => window.filoNotify('Avviso che resta', { durationSec: 0 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show .shell-notif-msg')).toHaveText('Avviso che resta');

  const prima = (await posa(app)).schede;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html('<!doctype html><html><body><p>dopo</p></body></html>'));
  await expect.poll(async () => (await posa(app)).schede).toBe(prima + 1);
  await expect.poll(async () => (await posa(app)).inCima).toBe(true);
  expect((await posa(app)).vista.width).toBeGreaterThan(100);

  // Stessi colori della shell, in chiaro e in scuro: la vista li prende dalla shell, non dal sistema.
  const sfondo = (p) => p.evaluate(() => getComputedStyle(document.querySelector('.shell-notif')).backgroundColor);
  await shell.emulateMedia({ colorScheme: 'light' });
  await expect.poll(async () => (await sfondo(vista)) === (await sfondo(shell))).toBe(true);
  const chiaro = await sfondo(vista);
  await shell.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => {
    const [v, s] = [await sfondo(vista), await sfondo(shell)];
    return v !== chiaro && v === s;
  }).toBe(true);

  await vista.locator('.shell-notif-close').click();
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });
  await expect(vista.locator('.shell-notif')).toHaveCount(0);
  await expect.poll(async () => (await posa(app)).vista.width).toBe(0);
});

test('il clic che arriva insieme all’avviso non ne aziona i pulsanti; la X sì, sempre', async ({ shell, avvisi }) => {
  // La pagina decide quando e sotto quale punto nasce un avviso (uno scaricamento che finisce, un
  // popup bloccato): il clic già partito verso di lei non deve diventare «Apri file».
  await shell.evaluate(() => {
    window.__fatto = 0;
    window.filoNotify('Con un’azione', { durationSec: 0, actions: [{ label: 'Fai', onClick: () => { window.__fatto++; } }] });
  });
  const vista = await avvisi();
  const azione = vista.locator('.shell-notif-action', { hasText: 'Fai' });
  await azione.waitFor();
  await azione.click({ force: true });
  await expect(azione).toBeDisabled();
  expect(await shell.evaluate(() => window.__fatto)).toBe(0);

  // Ferma la pila, l'azione si arma e risponde.
  await expect(azione).toBeEnabled({ timeout: 3000 });
  await azione.click();
  await expect.poll(() => shell.evaluate(() => window.__fatto)).toBe(1);
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });

  // La X di un avviso appena nato risponde subito: un no per sbaglio non costa niente.
  await shell.evaluate(() => window.filoNotify('Da chiudere', { durationSec: 0, actions: [{ label: 'Fai', onClick: () => {} }] }));
  await vista.locator('.shell-notif.show', { hasText: 'Da chiudere' }).locator('.shell-notif-close').click();
  await expect(shell.locator('.shell-notif', { hasText: 'Da chiudere' })).toHaveCount(0, { timeout: 4000 });
});

test('un popup bloccato si annuncia sopra la pagina e «Apri» lo apre in una scheda', async ({ app, shell, openTab, testServer, avvisi }) => {
  const target = testServer.html('<!doctype html><html><body><p id="t">POPUP APERTO</p></body></html>');
  const page = await testServer.openReady(openTab, '<!doctype html><html><body><p>pagina</p></body></html>');
  const prima = (await posa(app)).schede;
  await page.evaluate((u) => { window.open(u, '_blank', 'width=400,height=300'); }, target);

  await expect(shell.locator('.shell-notif', { hasText: 'Bloccato popup da' })).toHaveCount(1, { timeout: 8000 });
  const vista = await avvisi();
  const carta = vista.locator('.shell-notif.show', { hasText: 'Bloccato popup da 127.0.0.1' });
  await expect(carta).toBeVisible();
  expect((await posa(app)).schede).toBe(prima);

  await carta.locator('.shell-notif-action', { hasText: 'Apri' }).click();
  await expect.poll(async () => (await posa(app)).schede).toBe(prima + 1);
  await expect.poll(() => app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const attiva = tm.tabs.find((t) => t.id === tm.activeId);
    return !!attiva && attiva.url === u;
  }, target)).toBe(true);
});
