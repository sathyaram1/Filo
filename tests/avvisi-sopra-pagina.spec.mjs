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

// Il fuoco lo chiede la prova: il clic di Playwright non sposta la tastiera fra le viste come uno vero.
function tastieraAllaScheda(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tm = win._filoTabs;
    win.focus();
    tm.tabs.find((t) => t.id === tm.activeId).view.webContents.focus();
  });
}
function inFuoco(app) {
  return app.evaluate(({ webContents }) => {
    const f = webContents.getFocusedWebContents();
    return f ? f.getURL() : '';
  });
}

test('il primo avviso della finestra lascia la tastiera a chi scrive nella pagina, anche quando se ne va', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
    <input id="campo" style="margin:40px"></body></html>`);
  await tastieraAllaScheda(app);
  await page.locator('#campo').click();
  await expect.poll(() => inFuoco(app)).toContain(testServer.origin);

  // Il primo avviso fa nascere la vista: caricandosi dentro la finestra si prendeva la tastiera.
  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', { durationSec: 1 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  expect(await inFuoco(app)).toContain(testServer.origin);

  // Chi clicca la carta le dà la tastiera: sparito l'avviso, torna alla pagina.
  await shell.evaluate(() => window.filoNotify('secondo', { durationSec: 1 }));
  await expect(vista.locator('.shell-notif.show .shell-notif-msg', { hasText: 'secondo' })).toHaveCount(1);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.avvisi.vista.webContents.focus());
  await expect.poll(() => inFuoco(app)).toContain('avvisi.html');
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 5000 });
  await expect.poll(() => inFuoco(app)).toContain(testServer.origin);
});

test('gli avvisi di Filo nella pagina salgono sopra quelli della barra, e tornano giù quando la barra si svuota', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px">
    <a id="link" href="https://example.com/articolo">Un collegamento di prova</a></body></html>`);
  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', {
    durationSec: 0,
    actions: [{ label: 'Apri file', onClick: () => {} }, { label: 'Apri cartella', onClick: () => {} }],
  }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);

  // Un'azione di Filo sulla pagina, dal tasto destro, che risponde col suo avviso.
  const menu = page.locator('.sn-menu');
  let fatto = false;
  for (let i = 0; i < 6 && !fatto; i++) {
    await page.locator('#link').click({ button: 'right', position: { x: 8, y: 8 } });
    const voce = menu.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'immagine' });
    try {
      await voce.first().waitFor({ state: 'visible', timeout: 1500 });
      await voce.first().click();
      fatto = true;
    } catch (_) { await page.waitForTimeout(200); }
  }
  expect(fatto, 'voce «Copia URL» non raggiungibile').toBe(true);
  await expect(page.locator('.sn-toast')).toHaveCount(1, { timeout: 5000 });

  const coperti = async () => {
    const g = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      const tm = win._filoTabs;
      const tab = tm.tabs.find((t) => t.id === tm.activeId);
      return { v: tm.avvisi.vista.getBounds(), t: tab.view.getBounds() };
    });
    const toast = await page.evaluate(() => {
      const r = document.querySelector('.sn-toast').getBoundingClientRect();
      return { x: r.left, y: r.top, right: r.right, bottom: r.bottom };
    });
    const carta = await vista.evaluate(() => {
      const r = document.querySelector('.shell-notif').getBoundingClientRect();
      return { x: r.left, y: r.top, right: r.right, bottom: r.bottom };
    });
    const dx = g.v.x - g.t.x;
    const dy = g.v.y - g.t.y;
    return toast.x < carta.right + dx && carta.x + dx < toast.right && toast.y < carta.bottom + dy && carta.y + dy < toast.bottom;
  };
  await expect.poll(coperti).toBe(false);

  const fondo = () => page.evaluate(() => {
    const r = document.querySelector('.sn-toasts').getBoundingClientRect();
    return Math.round(innerHeight - r.bottom);
  });
  await vista.locator('.shell-notif-close').click();
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });
  await expect.poll(fondo).toBeLessThanOrEqual(24);
});

test('la X di un avviso dice «Chiudi» col suggerimento di Filo, che se ne va con l’avviso', async ({ app, shell, avvisi }) => {
  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', { durationSec: 0 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  const suggerimento = () => app.evaluate(async ({ BrowserWindow }) => {
    const testi = [];
    for (const w of BrowserWindow.getAllWindows()) {
      if (w._filoTabs || !w.isVisible()) continue;
      try { testi.push(await w.webContents.executeJavaScript('document.body ? document.body.innerText : ""')); } catch (_) {}
    }
    return testi.join(' | ');
  });
  await vista.locator('.shell-notif-close').hover();
  await expect.poll(suggerimento, { timeout: 4000 }).toMatch(/Chiudi/);
  await shell.evaluate(() => document.querySelector('.shell-notif-close').click());
  await expect.poll(suggerimento, { timeout: 4000 }).not.toMatch(/Chiudi/);
});
