// #1526 giro 1 — esplorazione del verificatore: strade e stress della pillola dello schermo pieno.
import { test, expect } from '../../fixtures/electron.mjs';

const LUNGO = 'accounts.google.com.verifica-sessione-utente-sicurezza-conto-bancario-online.esempio-lungo.test';
test.use({ hostInPiu: [LUNGO, 'xn--bcher-kva.test'] });

const PAGINA = `<html><body style="margin:0;background:#16324f;color:#fff">
<button id="vai" style="position:fixed;left:40px;top:40px;width:240px;height:90px">Schermo</button>
<button id="esci" style="position:fixed;left:40px;top:200px;width:240px;height:90px">Esci</button>
<script>
document.getElementById('vai').addEventListener('click', () => document.documentElement.requestFullscreen().catch(() => {}));
document.getElementById('esci').addEventListener('click', () => document.exitFullscreen().catch(() => {}));
document.addEventListener('keydown', (e) => { if (e.key === 'f') document.documentElement.requestFullscreen().catch(() => {}); });
</script></body></html>`;

function stato(app) {
  return app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tm = win._filoTabs;
    const sp = tm.schermoPieno;
    const vista = sp.vista && !sp.vista.webContents.isDestroyed() ? sp.vista : null;
    const b = vista ? vista.getBounds() : { x: 0, y: 0, width: 0, height: 0 };
    const visibile = !!(vista && b.width > 0 && b.height > 0);
    let dentro = null;
    if (visibile) {
      try {
        dentro = await vista.webContents.executeJavaScript(`(() => { const p = document.getElementById('pillola'); const r = p.getBoundingClientRect();
          return { testo: p.textContent, bottom: r.bottom, right: r.right, w: innerWidth, h: innerHeight }; })()`);
      } catch (_) {}
    }
    return { cf: tm.contentFullscreen, pf: tm.pageFullscreen, visibile, bounds: b, dentro, ntabs: tm.tabs.length };
  });
}

function clicca(app, x, y) {
  return app.evaluate(({ BrowserWindow }, [px, py]) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
    try { wc.focus(); } catch (_) {}
    wc.sendInputEvent({ type: 'mouseMove', x: px, y: py });
    wc.sendInputEvent({ type: 'mouseDown', x: px, y: py, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: px, y: py, button: 'left', clickCount: 1 });
  }, [x, y]);
}

const durata = (app, ms) => app.evaluate((_e, v) => globalThis.SN_STORAGE.updateSettings({ avvisoSchermoPieno: { durataMs: v } }), ms);

test('host lunghissimo: la pillola lo mostra intero, senza tagli', async ({ app, openTab, testServer }) => {
  const url = testServer.html(PAGINA).replace('127.0.0.1', LUNGO);
  await openTab(url);
  await new Promise((r) => setTimeout(r, 1500));
  await clicca(app, 120, 80);
  await expect.poll(async () => (await stato(app)).visibile, { timeout: 8000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 300));
  const s = await stato(app);
  expect(s.dentro.testo).toContain(LUNGO);
  expect(s.dentro.bottom).toBeLessThanOrEqual(s.dentro.h);
  expect(s.dentro.right).toBeLessThanOrEqual(s.dentro.w);
});

test('nome internazionale: la pillola dice il punycode', async ({ app, openTab, testServer }) => {
  const url = testServer.html(PAGINA).replace('127.0.0.1', 'bücher.test');
  await openTab(url);
  await new Promise((r) => setTimeout(r, 1500));
  await clicca(app, 120, 80);
  await expect.poll(async () => (await stato(app)).visibile, { timeout: 8000 }).toBe(true);
  expect((await stato(app)).dentro.testo).toContain('xn--bcher-kva.test');
});

test('la pagina esce da sola e rientra: la pillola sparisce e torna', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  await durata(app, 10000);
  await clicca(app, 120, 80);
  await expect.poll(async () => (await stato(app)).visibile, { timeout: 8000 }).toBe(true);
  await clicca(app, 120, 240);
  await expect.poll(async () => { const s = await stato(app); return [s.cf, s.visibile]; }, { timeout: 8000 }).toEqual([false, false]);
  await clicca(app, 120, 80);
  await expect.poll(async () => (await stato(app)).visibile, { timeout: 8000 }).toBe(true);
  expect((await stato(app)).dentro.testo).toContain('127.0.0.1');
});

test('schermo pieno chiesto da un tasto: la pillola compare', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
    wc.focus();
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'F' });
    wc.sendInputEvent({ type: 'char', keyCode: 'f' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'F' });
  });
  await expect.poll(async () => (await stato(app)).visibile, { timeout: 8000 }).toBe(true);
});

test('chiudere la scheda con la pillola a schermo la toglie', async ({ app, openTab, testServer }) => {
  await openTab('filo://editor/editor.html');
  await testServer.openReady(openTab, PAGINA);
  await durata(app, 10000);
  await clicca(app, 120, 80);
  await expect.poll(async () => (await stato(app)).visibile, { timeout: 8000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.closeTab(tm.activeId);
  });
  await expect.poll(async () => { const s = await stato(app); return [s.cf, s.visibile]; }, { timeout: 8000 }).toEqual([false, false]);
});

test('col puntatore sopra resta; uscendo va via', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  await durata(app, 1000);
  await clicca(app, 120, 80);
  await expect.poll(async () => (await stato(app)).visibile, { timeout: 8000 }).toBe(true);
  const b = (await stato(app)).bounds;
  await app.evaluate(({ BrowserWindow }, c) => {
    const v = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.schermoPieno.vista.webContents;
    v.sendInputEvent({ type: 'mouseMove', x: c.x, y: c.y });
  }, { x: Math.round(b.width / 2), y: Math.round(b.height / 2) - 6 });
  await new Promise((r) => setTimeout(r, 2500));
  expect((await stato(app)).visibile).toBe(true);
  await clicca(app, 600, 500);
  await app.evaluate(({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.schermoPieno.vista.webContents;
    v.sendInputEvent({ type: 'mouseLeave', x: -5, y: 200 });
  });
  await expect.poll(async () => (await stato(app)).visibile, { timeout: 5000 }).toBe(false);
});

test('esplora: la pagina naviga altrove a schermo pieno', async ({ app, openTab, testServer }) => {
  const altrove = testServer.html('<html><body>altro</body></html>', { pubblico: true });
  await testServer.openReady(openTab, PAGINA.replace("document.exitFullscreen().catch(() => {})", `location.href = ${JSON.stringify(altrove)}`));
  await durata(app, 10000);
  await clicca(app, 120, 80);
  await expect.poll(async () => (await stato(app)).visibile, { timeout: 8000 }).toBe(true);
  await clicca(app, 120, 240);
  await new Promise((r) => setTimeout(r, 2500));
  const s = await stato(app);
  console.log('DOPO-NAVIGAZIONE', JSON.stringify(s));
});
