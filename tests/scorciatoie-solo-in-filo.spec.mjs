// #838 — Alt+E/T/S/H valgono solo con Filo davanti: non sono più scorciatoie di
// sistema, e dentro Filo fanno quello che facevano. I tasti arrivano come quelli
// veri, iniettati sul webContents che ha il fuoco (scheda, riquadro, barra).

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';

const TESTO = `<!doctype html><html><body style="margin:0;padding:16px;font:16px sans-serif">
  <p id="testo">Una frase abbastanza lunga da poterla selezionare, spiegare e tradurre.</p>
  <script>
    window.__visti = [];
    addEventListener('keydown', (e) => { if (e.altKey) window.__visti.push(e.key); }, true);
  </script>
</body></html>`;

const INNER = `<!doctype html><html><body style="margin:0;padding:16px;font:16px sans-serif">
  <p id="inner-text">Testo dentro il riquadro incorporato, lungo abbastanza da selezionarlo.</p>
</body></html>`;

// Il tasto va al webContents della scheda attiva, o a quello della barra.
function premi(app, lettera, { dove = 'scheda', extra = [], incognito = false } = {}) {
  return app.evaluate(({ BrowserWindow }, o) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !!x._filoIncognito === o.incognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    const wc = o.dove === 'barra' ? w.webContents : t.view.webContents;
    const modifiers = ['alt', ...o.extra];
    wc.sendInputEvent({ type: 'keyDown', keyCode: o.lettera, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode: o.lettera, modifiers });
  }, { lettera, dove, extra, incognito });
}

function schede(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs;
    const attiva = t.tabs.find((x) => x.id === t.activeId);
    return { ids: t.tabs.map((x) => x.id), activeId: t.activeId, activeUrl: attiva ? attiva.url : '' };
  });
}

function seleziona(frame, selettore) {
  return frame.evaluate((sel) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(sel));
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }, selettore);
}

test('nessuna delle quattro resta presa agli altri programmi', async ({ app }) => {
  const prese = await app.evaluate(({ globalShortcut }) => ['E', 'T', 'S', 'H']
    .flatMap((l) => [`Alt+${l}`, `Control+Alt+${l}`])
    .filter((a) => globalShortcut.isRegistered(a)));
  expect(prese).toEqual([]);
});

test('Alt+E sul testo selezionato apre la spiegazione, e la pagina non vede il tasto', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, TESTO);
  await page.locator('#testo').click();
  await seleziona(page, '#testo');
  await premi(app, 'E');
  await expect(page.locator('.sn-popup .sn-popup-title')).toHaveText('Approfondimento', { timeout: 8000 });
  expect(await page.evaluate(() => window.__visti)).toEqual([]);
});

test('Alt+T sul testo selezionato apre la traduzione', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, TESTO);
  await page.locator('#testo').click();
  await seleziona(page, '#testo');
  await premi(app, 'T');
  await expect(page.locator('.sn-popup .sn-popup-title')).toHaveText('Traduzione', { timeout: 8000 });
});

test('Alt+H apre l\'Aiuto sulla pagina, anche col fuoco sulla barra di Filo', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, TESTO);
  await premi(app, 'H');
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8000 });

  const altra = await testServer.openReady(openTab, TESTO);
  await premi(app, 'H', { dove: 'barra' });
  await expect(altra.locator('.sn-sidebar')).toBeVisible({ timeout: 8000 });
});

test('Alt+H funziona anche su una pagina interna di Filo', async ({ app, openTab }) => {
  const page = await openTab('filo://options/options.html');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8000 });
  await premi(app, 'H');
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8000 });
});

test('Alt+E sul testo selezionato dentro un riquadro di un altro sito apre la spiegazione lì', async ({ app, openTab, testServer }) => {
  const innerUrl = testServer.html(INNER).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:12px">
    <iframe id="embed" src="${innerUrl}" width="600" height="300"></iframe></body></html>`);
  const frameLoc = page.frameLocator('#embed');
  await frameLoc.locator('#inner-text').click();
  const frame = page.frames().find((f) => f !== page.mainFrame());
  await seleziona(frame, '#inner-text');
  await premi(app, 'E');
  await expect(frameLoc.locator('.sn-popup')).toBeVisible({ timeout: 8000 });
});

test('Alt+S salva la pagina e chiude la scheda una volta sola, anche tenendolo premuto', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, TESTO);
  await testServer.openReady(openTab, TESTO.replace('<p id="testo">', '<p id="testo">Seconda. '));
  const prima = await schede(app);
  const url = prima.activeUrl;

  await premi(app, 'S');
  await expect.poll(() => schede(app).then((s) => s.ids.includes(prima.activeId)), { timeout: 10_000 }).toBe(false);
  await expect.poll(() => app.evaluate(async (_e, u) => (await globalThis.SN_STORAGE.getRaw('savedPages', []))
    .some((p) => p.url === u), url), { timeout: 10_000 }).toBe(true);

  const dopo = await schede(app);
  await premi(app, 'S', { extra: ['isAutoRepeat'] });
  await premi(app, 'S', { extra: ['isAutoRepeat'] });
  await new Promise((r) => setTimeout(r, 800));
  expect((await schede(app)).ids).toEqual(dopo.ids);
});

test('Alt+S in una finestra in incognito salva solo nella memoria di quella finestra', async ({ app, shell, testServer }) => {
  const url = testServer.html('<!doctype html><title>SEGRETO</title><h1 id="ok">incognito</h1>');
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    return !!(w && w._filoTabs && w._filoTabs.tabs.length);
  }), { timeout: 15_000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }, u) => {
    BrowserWindow.getAllWindows().find((x) => x._filoIncognito)._filoTabs.openTab(u);
  }, url);
  await expect.poll(() => app.windows().some((p) => { try { return p.url() === url; } catch (_) { return false; } }),
    { timeout: 10_000 }).toBe(true);
  const page = app.windows().find((p) => p.url() === url);
  await page.waitForSelector('#ok');
  const idIncognito = await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((x) => x._filoIncognito)._filoTabs;
    return t.activeId;
  });

  const normale = await schede(app);
  await premi(app, 'S', { incognito: true });

  await expect.poll(() => app.evaluate(({ BrowserWindow }, id) => {
    const t = BrowserWindow.getAllWindows().find((x) => x._filoIncognito)._filoTabs;
    return t.tabs.some((x) => x.id === id);
  }, idIncognito), { timeout: 10_000 }).toBe(false);
  const dove = await app.evaluate(async (_e, u) => {
    const S = globalThis.SN_STORAGE;
    const suDisco = (await S.getRaw('savedPages', [])).some((p) => p.url === u);
    const inMemoria = await globalThis.__filoStorage.runIncognito(async () =>
      (await S.getRaw('savedPages', [])).some((p) => p.url === u));
    return { suDisco, inMemoria };
  }, url);
  expect(dove).toEqual({ suDisco: false, inMemoria: true });
  expect((await schede(app)).ids).toEqual(normale.ids);
});

// Da qui il tasto va a chi ha davvero la tastiera, come uno vero: se nessuno ce
// l'ha si perde. Dopo una scheda chiusa o cambiata la tastiera restava a nessuno.
function premiDoveHaLaTastiera(app, keyCode, modifiers) {
  return app.evaluate(({ webContents }, o) => {
    const f = webContents.getFocusedWebContents();
    if (!f) return false;
    f.sendInputEvent({ type: 'keyDown', keyCode: o.keyCode, modifiers: o.modifiers });
    f.sendInputEvent({ type: 'keyUp', keyCode: o.keyCode, modifiers: o.modifiers });
    return true;
  }, { keyCode, modifiers });
}

async function quattroPagineColFuocoSullUltima(app, openTab, testServer) {
  for (let i = 1; i <= 4; i++) await testServer.openReady(openTab, TESTO.replace('<p id="testo">', `<p id="testo">Pagina ${i}. `));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.show(); w.focus();
    w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents.focus();
  });
}

function tastieraSullaAttiva(app) {
  return app.evaluate(({ BrowserWindow, webContents }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return webContents.getFocusedWebContents() === t.view.webContents;
  });
}

function aiutoSullaAttiva(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return t.view.webContents.executeJavaScript('!!document.querySelector(".sn-sidebar")');
  });
}

test('Alt+S premuto due volte di fila salva e chiude due schede', async ({ app, openTab, testServer }) => {
  await quattroPagineColFuocoSullUltima(app, openTab, testServer);
  const n = (await schede(app)).ids.length;
  expect(await premiDoveHaLaTastiera(app, 'S', ['alt'])).toBe(true);
  await expect.poll(async () => (await schede(app)).ids.length, { timeout: 10_000 }).toBe(n - 1);
  await expect.poll(() => tastieraSullaAttiva(app)).toBe(true);
  await premiDoveHaLaTastiera(app, 'S', ['alt']);
  await expect.poll(async () => (await schede(app)).ids.length, { timeout: 10_000 }).toBe(n - 2);
});

test('Ctrl+W premuto due volte di fila chiude due schede', async ({ app, openTab, testServer }) => {
  await quattroPagineColFuocoSullUltima(app, openTab, testServer);
  const n = (await schede(app)).ids.length;
  expect(await premiDoveHaLaTastiera(app, 'W', ['control'])).toBe(true);
  await expect.poll(async () => (await schede(app)).ids.length).toBe(n - 1);
  await expect.poll(() => tastieraSullaAttiva(app)).toBe(true);
  await premiDoveHaLaTastiera(app, 'W', ['control']);
  await expect.poll(async () => (await schede(app)).ids.length).toBe(n - 2);
});

for (const [nome, keyCode, modifiers] of [
  ['Ctrl+W', 'W', ['control']],
  ['il salto di scheda con Alt+2', '2', ['alt']],
]) {
  test(`dopo ${nome}, Alt+H apre l'Aiuto sulla scheda che resta davanti`, async ({ app, openTab, testServer }) => {
    await quattroPagineColFuocoSullUltima(app, openTab, testServer);
    const prima = (await schede(app)).activeId;
    expect(await premiDoveHaLaTastiera(app, keyCode, modifiers)).toBe(true);
    await expect.poll(async () => (await schede(app)).activeId).not.toBe(prima);
    await expect.poll(() => tastieraSullaAttiva(app)).toBe(true);
    // Una pagina appena tornata davanti perde un messaggio nei primi decimi di
    // secondo, anche mandato a mano: si aspetta che risponda, come un dito vero.
    await aiutoSullaAttiva(app);
    await premiDoveHaLaTastiera(app, 'H', ['alt']);
    await expect.poll(() => aiutoSullaAttiva(app), { timeout: 8000 }).toBe(true);
  });
}

test('col fuoco sulla barra, cambiare scheda non le toglie la tastiera', async ({ app, openTab, testServer }) => {
  await quattroPagineColFuocoSullUltima(app, openTab, testServer);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.webContents.focus();
    w._filoTabs.activate(w._filoTabs.tabs[1].id);
  });
  expect(await app.evaluate(({ BrowserWindow, webContents }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return webContents.getFocusedWebContents() === w.webContents;
  })).toBe(true);
});

// Un PDF si apre nel visore, che è un webContents a sé e prende la tastiera
// appena il documento compare: da lì i tasti di Filo devono valere come dalla pagina.
function pdfMinimo(testo) {
  const ogg = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const flusso = `BT /F1 24 Tf 72 700 Td (${testo}) Tj ET`;
  ogg[3] = `<< /Length ${flusso.length} >>\nstream\n${flusso}\nendstream`;
  let out = '%PDF-1.4\n';
  const off = [];
  ogg.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${ogg.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${ogg.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const testPdf = test.extend({
  pdfUrl: async ({}, use) => {
    const pdf = pdfMinimo('Manuale di prova');
    const srv = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end(pdf); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    await use(`http://127.0.0.1:${srv.address().port}/manuale.pdf`);
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  },
});

// Apre il PDF davanti a una pagina qualunque e aspetta che il visore abbia la tastiera.
async function pdfColTastieraNelVisore(app, shell, openTab, testServer, pdfUrl) {
  await testServer.openReady(openTab, TESTO);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.show(); w.focus();
  });
  await shell.evaluate((u) => window.filoShell.tabs.open(u), pdfUrl);
  await expect.poll(() => app.evaluate(({ webContents }) => {
    const f = webContents.getFocusedWebContents();
    return !!f && f.getType() === 'remote' && !f.isLoading();
  }), { timeout: 15_000 }).toBe(true);
  return (await schede(app)).activeId;
}

function premiNelVisore(app, keyCode, modifiers) {
  return app.evaluate(({ webContents }, o) => {
    const visore = webContents.getFocusedWebContents();
    visore.sendInputEvent({ type: 'keyDown', keyCode: o.keyCode, modifiers: o.modifiers });
    visore.sendInputEvent({ type: 'keyUp', keyCode: o.keyCode, modifiers: o.modifiers });
  }, { keyCode, modifiers });
}

testPdf('dal visore di un PDF Alt+S salva il documento e chiude la scheda una volta sola, anche tenendolo premuto', async ({ app, shell, openTab, testServer, pdfUrl }) => {
  const id = await pdfColTastieraNelVisore(app, shell, openTab, testServer, pdfUrl);
  const n = (await schede(app)).ids.length;
  await app.evaluate(({ webContents }) => {
    const visore = webContents.getFocusedWebContents();
    visore.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: ['alt'] });
    visore.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: ['alt', 'isAutoRepeat'] });
    visore.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: ['alt', 'isAutoRepeat'] });
    visore.sendInputEvent({ type: 'keyUp', keyCode: 'S', modifiers: ['alt'] });
  });
  await expect.poll(() => app.evaluate(async (_e, u) => (await globalThis.SN_STORAGE.getRaw('savedPages', []))
    .some((p) => p.url === u), pdfUrl), { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await schede(app)).ids.includes(id), { timeout: 10_000 }).toBe(false);
  await new Promise((r) => setTimeout(r, 800));
  expect((await schede(app)).ids.length).toBe(n - 1);
});

testPdf('dal visore di un PDF Alt+H apre l\'Aiuto sopra il documento', async ({ app, shell, openTab, testServer, pdfUrl }) => {
  await pdfColTastieraNelVisore(app, shell, openTab, testServer, pdfUrl);
  await premiNelVisore(app, 'H', ['alt']);
  await expect.poll(() => aiutoSullaAttiva(app), { timeout: 10_000 }).toBe(true);
});

testPdf('dal visore di un PDF valgono anche Ctrl+T, Alt+cifra e Ctrl+W, ciascuno una volta', async ({ app, shell, openTab, testServer, pdfUrl }) => {
  const id = await pdfColTastieraNelVisore(app, shell, openTab, testServer, pdfUrl);
  const n = (await schede(app)).ids.length;

  await premiNelVisore(app, 'T', ['control']);
  await expect.poll(async () => (await schede(app)).ids.length).toBe(n + 1);
  await app.evaluate(({ BrowserWindow }, tid) => {
    const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    t.closeTab(t.activeId);
    t.activate(tid);
  }, id);
  await expect.poll(() => app.evaluate(({ webContents }) => {
    const f = webContents.getFocusedWebContents();
    return !!f && f.getType() === 'remote';
  }), { timeout: 10_000 }).toBe(true);

  await premiNelVisore(app, '1', ['alt']);
  await expect.poll(async () => (await schede(app)).activeId).not.toBe(id);
  await app.evaluate(({ BrowserWindow }, tid) => {
    BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.activate(tid);
  }, id);
  await expect.poll(() => app.evaluate(({ webContents }) => {
    const f = webContents.getFocusedWebContents();
    return !!f && f.getType() === 'remote';
  }), { timeout: 10_000 }).toBe(true);

  await premiNelVisore(app, 'W', ['control']);
  await expect.poll(async () => (await schede(app)).ids.includes(id)).toBe(false);
  expect((await schede(app)).ids.length).toBe(n - 1);
});
