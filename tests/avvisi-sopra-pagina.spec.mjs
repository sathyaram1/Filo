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

test('il primo avviso della finestra lascia la tastiera a chi scrive nella pagina, e un clic sulla carta gliela restituisce subito', async ({ app, shell, openTab, testServer, avvisi }) => {
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

  // Chi clicca la carta le dà la tastiera: torna alla pagina subito, con l'avviso ancora lì (#588.5 giro 2).
  await shell.evaluate(() => window.filoNotify('secondo', { durationSec: 0 }));
  await expect(vista.locator('.shell-notif.show .shell-notif-msg', { hasText: 'secondo' })).toHaveCount(1);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.avvisi.vista.webContents.focus());
  await expect.poll(() => inFuoco(app)).toContain(testServer.origin);
  await expect(shell.locator('.shell-notif', { hasText: 'secondo' })).toHaveCount(1);
});

// Un gesto vero dentro la vista: sendInputEvent passa dal suo renderer come un clic dell'utente, senza la
// scelta fra le viste che fa il sistema (la vista copre quel punto per costruzione).
function gestoNellaVista(app, ev) {
  return app.evaluate(({ BrowserWindow }, e) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.avvisi.vista.webContents.sendInputEvent(e);
  }, ev);
}
// Il punto della pagina, in coordinate della vista.
async function nellaVista(app, page, sel) {
  const g = await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { v: tm.avvisi.vista.getBounds(), t: tm.tabs.find((t) => t.id === tm.activeId).view.getBounds() };
  });
  const r = await page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
  return { x: Math.round(g.t.x + r.x - g.v.x), y: Math.round(g.t.y + r.y - g.v.y) };
}

test('nel vuoto attorno agli avvisi la pagina risponde: clic, doppio clic, tasto destro e rotella', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;height:4000px">
    <button id="angolo" style="position:fixed;right:3px;bottom:3px;width:10px;height:10px;padding:0"></button>
    <p id="parola" style="position:fixed;right:250px;bottom:110px;margin:0;font:14px sans-serif">parola</p>
    <script>
      window.__clic = 0;
      document.getElementById('angolo').addEventListener('click', () => { window.__clic++; });
    </script></body></html>`);
  await shell.evaluate(() => {
    window.filoNotify('Bloccato popup', { durationSec: 0, actions: [{ label: 'Apri', onClick: () => {} }] });
    window.filoNotify('Scaricato: Relazione trimestrale definitiva (versione corretta) 2026.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }, { label: 'Apri cartella', onClick: () => {} }] });
  });
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(2);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.avvisi.vista.getBounds().height)).toBeGreaterThan(150);

  // Il margine all'angolo della finestra: dentro la vista, fuori dalle carte.
  const a = await nellaVista(app, page, '#angolo');
  expect(await vista.evaluate(({ x, y }) => x < innerWidth && y < innerHeight && !document.elementFromPoint(x, y)?.closest('.shell-notif'), a)).toBe(true);
  await gestoNellaVista(app, { type: 'mouseDown', x: a.x, y: a.y, button: 'left', clickCount: 1 });
  await gestoNellaVista(app, { type: 'mouseUp', x: a.x, y: a.y, button: 'left', clickCount: 1 });
  await expect.poll(() => page.evaluate(() => window.__clic)).toBe(1);
  await gestoNellaVista(app, { type: 'mouseDown', x: a.x, y: a.y, button: 'right', clickCount: 1 });
  await gestoNellaVista(app, { type: 'mouseUp', x: a.x, y: a.y, button: 'right', clickCount: 1 });
  // Il tasto destro nel vuoto è quello della pagina: si apre il menu di Filo sulla pagina.
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Escape');

  // Accanto alla carta più stretta: il doppio clic seleziona la parola della pagina.
  const p = await nellaVista(app, page, '#parola');
  expect(await vista.evaluate(({ x, y }) => !document.elementFromPoint(x, y)?.closest('.shell-notif'), p)).toBe(true);
  for (const n of [1, 2]) {
    await gestoNellaVista(app, { type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: n });
    await gestoNellaVista(app, { type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: n });
  }
  await expect.poll(() => page.evaluate(() => String(getSelection()).trim())).toBe('parola');
  // Sopra il testo della pagina il puntatore è quello del testo, come fuori dalla vista.
  await gestoNellaVista(app, { type: 'mouseMove', x: p.x + 1, y: p.y });
  await expect.poll(() => vista.evaluate(() => document.documentElement.style.cursor)).toBe('text');

  // La rotella sopra una carta scorre la pagina, nello stesso verso che avrebbe sulla pagina.
  const c = await vista.evaluate(() => { const r = document.querySelector('.shell-notif-msg').getBoundingClientRect(); return { x: Math.round(r.left + 5), y: Math.round(r.top + 5) }; });
  await gestoNellaVista(app, { type: 'mouseWheel', x: c.x, y: c.y, deltaX: 0, deltaY: -120, canScroll: true });
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(50);
});

test('tasto destro su un avviso: il menu ha le sue azioni e «Chiudi», e la scelta fa quello che fa il pulsante', async ({ app, shell, avvisi }) => {
  await shell.evaluate(() => {
    window.__cartella = 0;
    window.filoNotify('Scaricato: report.pdf', {
      durationSec: 0,
      actions: [{ label: 'Apri file', onClick: () => {} }, { label: 'Apri cartella', onClick: () => { window.__cartella++; } }],
    });
  });
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  const trovaMenu = async () => {
    let menu = null;
    await expect.poll(async () => {
      for (const w of app.windows()) {
        try { if (await w.evaluate(() => [...document.querySelectorAll('button.item')].some((b) => /Chiudi/.test(b.textContent)))) { menu = w; return true; } } catch (_) {}
      }
      return false;
    }, { timeout: 8_000 }).toBe(true);
    return menu;
  };

  await vista.locator('.shell-notif-msg').click({ button: 'right' });
  let menu = await trovaMenu();
  expect(await menu.evaluate(() => [...document.querySelectorAll('button.item')].map((b) => b.textContent.trim()))).toEqual(['Apri file', 'Apri cartella', 'Chiudi']);
  // Il menu, aperto in fondo alla finestra, ci sta dentro: sale sopra il punto invece di uscire sotto.
  const dentro = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const m = BrowserWindow.getAllWindows().find((w) => w !== win && w.getParentWindow() === win && w.isVisible() && w.getBounds().height > 60);
    const cb = win.getContentBounds();
    const b = m.getBounds();
    return b.y + b.height - 26 <= cb.y + cb.height + 1;
  });
  expect(dentro).toBe(true);
  await menu.evaluate(() => [...document.querySelectorAll('button.item')].find((b) => /Apri cartella/.test(b.textContent)).click());
  await expect.poll(() => shell.evaluate(() => window.__cartella)).toBe(1);
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });

  // «Chiudi» dal menu chiude l'avviso.
  await shell.evaluate(() => window.filoNotify('Da chiudere', { durationSec: 0 }));
  await vista.locator('.shell-notif.show .shell-notif-msg', { hasText: 'Da chiudere' }).click({ button: 'right' });
  menu = await trovaMenu();
  await menu.evaluate(() => [...document.querySelectorAll('button.item')].find((b) => /Chiudi/.test(b.textContent)).click());
  await expect(shell.locator('.shell-notif')).toHaveCount(0, { timeout: 4000 });
});

test('cambiando lo zoom della pagina con un avviso aperto, gli avvisi di Filo nella pagina restano sopra', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="margin:0"><p>pagina</p></body></html>');
  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }] }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  // La pila della pagina (quella dei suoi avvisi), misurata in pixel dello schermo contro l'altezza della vista.
  const scarto = async () => {
    const barra = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.avvisi.vista.getBounds().height);
    const m = await page.evaluate(() => {
      let h = document.querySelector('.sn-toasts');
      if (!h) { h = document.createElement('div'); h.className = 'sn-toasts'; h.innerHTML = '<div style="height:40px;width:200px">avviso</div>'; document.documentElement.appendChild(h); }
      return { fondo: innerHeight - h.getBoundingClientRect().bottom, zoom: window.devicePixelRatio };
    });
    const scala = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().scaleFactor);
    return Math.round(m.fondo * (m.zoom / scala)) - barra;
  };
  await expect.poll(scarto).toBeGreaterThanOrEqual(-1);
  for (const z of [0.5, 1.5]) {
    await app.evaluate(({ BrowserWindow }, f) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      tm.tabs.find((t) => t.id === tm.activeId).view.webContents.setZoomFactor(f);
    }, z);
    await expect.poll(scarto).toBeGreaterThanOrEqual(-1);
    await expect.poll(scarto).toBeLessThanOrEqual(2);
  }
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
