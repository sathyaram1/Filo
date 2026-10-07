// #839 dopo il riallineamento su #838: le scorciatoie non sono più di sistema, il tasto
// arriva dal webContents dove lo premi. Qui Alt+S si preme come un tasto vero (scheda,
// barra, menu della linguetta, visore PDF, incognito) e si guarda la conferma del lavoro.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = (t) => `<!doctype html><html><head><title>${t}</title></head><body style="margin:0;padding:16px;font:16px sans-serif;background:linear-gradient(135deg,#f6d365,#a1c4fd)">
  <p>${'Una pagina da mettere da parte per dopo, con abbastanza testo. '.repeat(40)}</p></body></html>`;

function premiSu(app, { dove = 'scheda', incognito = false } = {}) {
  return app.evaluate(({ BrowserWindow }, o) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !!x._filoIncognito === o.incognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    const wc = o.dove === 'barra' ? w.webContents : t.view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: ['alt'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'S', modifiers: ['alt'] });
  }, { dove, incognito });
}

function schede(app, incognito = false) {
  return app.evaluate(({ BrowserWindow }, inc) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !!x._filoIncognito === inc);
    return { ids: w._filoTabs.tabs.map((x) => x.id), activeId: w._filoTabs.activeId };
  }, incognito);
}

function salvata(app, url) {
  return app.evaluate(async ({ nativeImage }, u) => {
    const p = (await globalThis.SN_STORAGE.getRaw('savedPages', [])).filter((x) => x.url === u);
    if (!p.length) return null;
    const t = p[0].thumbnail || '';
    const w = t ? nativeImage.createFromDataURL(t).getSize().width : 0;
    return { n: p.length, id: p[0].id, mime: t ? t.slice(5, t.indexOf(';')) : '', width: w, bytes: t ? Math.floor((t.length - t.indexOf(',') - 1) * 3 / 4) : 0 };
  }, url);
}

async function miniaturaPiccola(app, url) {
  let s = null;
  await expect.poll(async () => { s = await salvata(app, url); return !!(s && s.mime); }, { timeout: 10_000 }).toBe(true);
  expect(s.n).toBe(1);
  expect(s.mime).toBe('image/jpeg');
  expect(s.width).toBeLessThanOrEqual(420);
  expect(s.bytes).toBeLessThan(60 * 1024);
  return s;
}

// openTab trova la pagina per nome del sito: con due pagine dello stesso server serve l'indirizzo intero.
async function apriEsatta(app, openTab, url) {
  await openTab(url);
  let page = null;
  await expect.poll(() => { page = app.windows().find((p) => { try { return p.url() === url; } catch (_) { return false; } }); return !!page; }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

test('Alt+S premuto sulla pagina: conferma cliccabile, miniatura piccola, e la conferma porta alla voce', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA('Prima'));
  const url = testServer.html(PAGINA('Da salvare'));
  const page = await apriEsatta(app, openTab, url);
  await premiSu(app);
  const pill = page.locator('.sn-save-confirm');
  await expect(pill).toBeVisible({ timeout: 5000 });
  const s = await miniaturaPiccola(app, url);
  const chiusa = page.waitForEvent('close', { timeout: 8000 });
  await pill.click();
  let home = null;
  await expect.poll(() => {
    home = app.windows().find((w) => { try { return w.url().startsWith('filo://home/home.html'); } catch (_) { return false; } });
    return !!home;
  }, { timeout: 8000 }).toBe(true);
  expect(home.url()).toContain(`highlight=${s.id}`);
  await chiusa;
});

test('Alt+S col fuoco sulla barra di Filo: stessa conferma sulla pagina attiva', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA('Prima'));
  const url = testServer.html(PAGINA('Dalla barra'));
  const page = await apriEsatta(app, openTab, url);
  const id = (await schede(app)).activeId;
  await premiSu(app, { dove: 'barra' });
  await expect(page.locator('.sn-save-confirm')).toBeVisible({ timeout: 5000 });
  await miniaturaPiccola(app, url);
  await expect.poll(async () => (await schede(app)).ids.includes(id), { timeout: 10_000 }).toBe(false);
});

test('Alt+S col menu della linguetta aperto salva la pagina attiva con la sua conferma', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA('Prima'));
  const url = testServer.html(PAGINA('Dal menu linguetta'));
  const page = await apriEsatta(app, openTab, url);
  await shell.evaluate(() => {
    const el = document.querySelector('.tab.active') || document.querySelector('.tab');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) }));
  });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.webContents.getURL().startsWith('data:text/html'))), { timeout: 8000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    const m = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().startsWith('data:text/html'));
    m.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: ['alt'] });
    m.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'S', modifiers: ['alt'] });
  });
  await expect(page.locator('.sn-save-confirm')).toBeVisible({ timeout: 5000 });
  await miniaturaPiccola(app, url);
});

test('con l\'incognito aperto dietro, Alt+S nella finestra normale davanti salva e chiude lì, sul disco', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA('Prima'));
  await shell.evaluate(() => window.filoShell.openIncognito());
  const urlInc = testServer.html(PAGINA('In incognito'));
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    return !!(w && w._filoTabs && w._filoTabs.tabs.length);
  }), { timeout: 15_000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }, u) => { BrowserWindow.getAllWindows().find((x) => x._filoIncognito)._filoTabs.openTab(u); }, urlInc);
  await expect.poll(() => app.windows().some((p) => { try { return p.url() === urlInc; } catch (_) { return false; } }), { timeout: 10_000 }).toBe(true);
  const inc = await schede(app, true);

  const url = testServer.html(PAGINA('Normale davanti'));
  const page = await apriEsatta(app, openTab, url);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.show(); w.focus();
  });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const f = BrowserWindow.getFocusedWindow();
    return !!(f && f._filoTabs && !f._filoIncognito);
  }), { timeout: 5000 }).toBe(true);
  const id = (await schede(app)).activeId;
  await premiSu(app);
  await expect(page.locator('.sn-save-confirm')).toBeVisible({ timeout: 5000 });
  await miniaturaPiccola(app, url);
  await expect.poll(async () => (await schede(app)).ids.includes(id), { timeout: 10_000 }).toBe(false);
  expect((await schede(app, true)).ids).toEqual(inc.ids);
});

test('in incognito davanti, Alt+S premuto lì mostra la conferma e salva solo nella memoria della finestra', async ({ app, shell, testServer }) => {
  const url = testServer.html(PAGINA('Segreto'));
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    return !!(w && w._filoTabs && w._filoTabs.tabs.length);
  }), { timeout: 15_000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }, u) => { BrowserWindow.getAllWindows().find((x) => x._filoIncognito)._filoTabs.openTab(u); }, url);
  let page = null;
  await expect.poll(() => { page = app.windows().find((p) => { try { return p.url() === url; } catch (_) { return false; } }); return !!page; }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const normale = await schede(app);
  await premiSu(app, { incognito: true });
  await expect(page.locator('.sn-save-confirm')).toBeVisible({ timeout: 5000 });
  const dove = async () => app.evaluate(async (_e, u) => {
    const S = globalThis.SN_STORAGE;
    const suDisco = (await S.getRaw('savedPages', [])).some((p) => p.url === u);
    const inMemoria = await globalThis.__filoStorage.runIncognito(async () => (await S.getRaw('savedPages', [])).some((p) => p.url === u && /^data:image\/jpeg/.test(p.thumbnail || '')));
    return { suDisco, inMemoria };
  }, url);
  await expect.poll(dove, { timeout: 10_000 }).toEqual({ suDisco: false, inMemoria: true });
  expect((await schede(app)).ids).toEqual(normale.ids);
});

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

test('dal visore di un PDF Alt+S salva con la miniatura piccola e mostra la conferma', async ({ app, shell, openTab, testServer }) => {
  const pdf = pdfMinimo('Manuale di prova');
  const srv = createServer((_q, res) => { res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end(pdf); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const pdfUrl = `http://127.0.0.1:${srv.address().port}/manuale.pdf`;
  try {
    await testServer.openReady(openTab, PAGINA('Prima'));
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito); w.show(); w.focus(); });
    await shell.evaluate((u) => window.filoShell.tabs.open(u), pdfUrl);
    await expect.poll(() => app.evaluate(({ webContents }) => {
      const f = webContents.getFocusedWebContents();
      return !!f && f.getType() === 'remote' && !f.isLoading();
    }), { timeout: 15_000 }).toBe(true);
    const id = (await schede(app)).activeId;
    // La conferma può comparire sulla pagina del PDF o, se quella non risponde, sulla scheda rimasta davanti.
    await app.evaluate(({ BrowserWindow }) => {
      globalThis.__vistaConferma = false;
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      const guarda = () => {
        for (const t of w._filoTabs.tabs) {
          try { t.view.webContents.executeJavaScript('!!document.querySelector(".sn-save-confirm")').then((v) => { if (v) globalThis.__vistaConferma = true; }).catch(() => {}); } catch (_) {}
        }
      };
      globalThis.__guardaConferma = setInterval(guarda, 100);
    });
    await app.evaluate(({ webContents }) => {
      const v = webContents.getFocusedWebContents();
      v.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: ['alt'] });
      v.sendInputEvent({ type: 'keyUp', keyCode: 'S', modifiers: ['alt'] });
    });
    await miniaturaPiccola(app, pdfUrl);
    await expect.poll(async () => (await schede(app)).ids.includes(id), { timeout: 12_000 }).toBe(false);
    await expect.poll(() => app.evaluate(() => globalThis.__vistaConferma), { timeout: 12_000 }).toBe(true);
  } finally {
    try { await app.evaluate(() => clearInterval(globalThis.__guardaConferma)); } catch (_) {}
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  }
});
