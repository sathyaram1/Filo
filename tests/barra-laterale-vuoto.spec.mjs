// #871 — il vuoto trasparente accanto alla barra aperta (l'ombra, le fasce sopra e sotto il pannello) è della
// pagina: clic, doppio clic, tasto destro e rotella che ci cadono arrivano al sito, e il clic chiude la barra.
// Regole: patterns/la-shell-non-disegna-sopra-la-pagina.md

import { test, expect } from './fixtures/electron.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from './helpers/barra.mjs';

const SITO = `<!doctype html><html><body style="margin:0;height:4000px;font:16px sans-serif">
  <div id="z" style="position:fixed;left:0;top:0;width:240px;height:100%;background:#f3eee6">colonna del sito</div>
  <script>
    window.gesti = { clic: 0, doppio: 0 };
    const z = document.getElementById('z');
    z.addEventListener('click', () => window.gesti.clic++);
    z.addEventListener('dblclick', () => window.gesti.doppio++);
  </script>
</body></html>`;

function nelVuoto(app, eventi) {
  return app.evaluate(({ BrowserWindow }, ev) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const wc = w._filoTabs.barra.vista.webContents;
    for (const e of ev) wc.sendInputEvent(e);
  }, eventi);
}
const clic = (x, y, button = 'left', clickCount = 1) => [
  { type: 'mouseDown', x, y, button, clickCount },
  { type: 'mouseUp', x, y, button, clickCount },
];

test('barra aperta: rotella, tasto destro, doppio clic e clic nel margine dell\'ombra arrivano alla pagina', async ({ app, openTab, testServer }) => {
  const p = await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  // Aperta da tastiera resta aperta col mouse sulla pagina: il margine resta dov'è.
  await comandaBarra(app, 'tasto');
  await pannelloFermo(barra);
  const s = await statoBarra(app);
  const x = s.bounds.width - 6;
  expect(x).toBeGreaterThan(56);

  await nelVuoto(app, [{ type: 'mouseMove', x, y: 300 }, { type: 'mouseWheel', x, y: 300, deltaX: 0, deltaY: -600 }]);
  await expect.poll(() => p.evaluate(() => window.scrollY), { timeout: 3000 }).toBeGreaterThan(0);

  // Il tasto destro nel vuoto è quello della pagina: si apre il menu di Filo sulla pagina.
  await nelVuoto(app, clic(x, 300, 'right'));
  await expect(p.locator('.sn-menu')).toBeVisible({ timeout: 5000 });
  await comandaBarra(app, 'chiudi');
  await p.keyboard.press('Escape');
  await expect(p.locator('.sn-menu')).toBeHidden();
  await comandaBarra(app, 'tasto');
  await pannelloFermo(barra);

  await nelVuoto(app, [...clic(x, 320), ...clic(x, 320, 'left', 2)]);
  await expect.poll(() => p.evaluate(() => window.gesti.doppio), { timeout: 3000 }).toBe(1);
  expect(await p.evaluate(() => window.gesti.clic)).toBeGreaterThanOrEqual(1);
  // Il clic arrivato alla pagina chiude la barra, come ogni clic sulla pagina.
  await expect.poll(async () => (await statoBarra(app)).aperta, { timeout: 3000 }).toBe(false);
});

test('la fascia sotto il pannello è della pagina, il pannello no', async ({ app, openTab, testServer }) => {
  const p = await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  await comandaBarra(app, 'tasto');
  await pannelloFermo(barra);
  const s = await statoBarra(app);
  // Sul pannello (fra le icone) la rotella resta della barra.
  await nelVuoto(app, [{ type: 'mouseMove', x: 28, y: 200 }, { type: 'mouseWheel', x: 28, y: 200, deltaX: 0, deltaY: -600 }]);
  await p.waitForTimeout(400);
  expect(await p.evaluate(() => window.scrollY)).toBe(0);
  // Sotto il pannello, a filo del fondo della finestra: della pagina.
  const y = s.bounds.height - 3;
  await nelVuoto(app, [{ type: 'mouseMove', x: 20, y }, { type: 'mouseWheel', x: 20, y, deltaX: 0, deltaY: -600 }]);
  await expect.poll(() => p.evaluate(() => window.scrollY), { timeout: 3000 }).toBeGreaterThan(0);
});

// La pagina segnalata sotto l'avviso del sito: un pulsante grande quanto lei, e il conto dei gesti che riceve.
const SEGNALATA = '<title>Accedi</title><body style="margin:0;height:3000px"><button style="position:fixed;inset:0;width:100%;height:100%">Accedi</button>'
  + '<script>window.__g={giu:0,clic:0,rotella:0};document.addEventListener("mousedown",function(){__g.giu++},true);'
  + 'document.addEventListener("click",function(){__g.clic++},true);document.addEventListener("wheel",function(){__g.rotella++},true);</script></body>';

async function apriSegnalata(app, shell) {
  await app.evaluate(async ({ session, net }, html) => {
    const risposta = (req) => (new URL(req.url).hostname === 'conto-paypa1.com'
      ? new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      : net.fetch(req, { bypassCustomProtocolHandlers: true }));
    for (const s of ['http', 'https']) {
      try { session.defaultSession.protocol.unhandle(s); } catch (_) {}
      session.defaultSession.protocol.handle(s, risposta);
    }
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: async () => ({ listed: true, category: 'phishing' }), rdap: null, ct: null, sandbox: null, llm: async () => ({ suspicious: false }) });
  }, SEGNALATA);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), 'https://conto-paypa1.com/login');
  let page = null;
  await expect.poll(() => { page = app.windows().find((w) => { try { return new URL(w.url()).hostname === 'conto-paypa1.com'; } catch (_) { return false; } }); return !!page; }).toBe(true);
  await expect.poll(() => coperta(app), { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => !!window.__g);
  let avviso = null;
  await expect.poll(() => { avviso = app.windows().find((w) => { try { return w.url().startsWith('filo://shell/avviso-sito.html'); } catch (_) { return false; } }); return !!avviso; }).toBe(true);
  await avviso.evaluate(() => { window.__g = 0; document.addEventListener('mousedown', () => { window.__g++; }, true); });
  return { page, avviso };
}
const coperta = (app) => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.avvisoSito.coperta());

function nellaVista(app, quale, eventi) {
  return app.evaluate(({ BrowserWindow }, { q, ev }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    const wc = (q === 'barra' ? tm.barra : tm.avvisi).vista.webContents;
    for (const e of ev) wc.sendInputEvent(e);
  }, { q: quale, ev: eventi });
}

test('sopra l\'avviso del sito pericoloso il vuoto della barra e degli avvisi è dell\'avviso: la pagina segnalata non riceve niente', async ({ app, shell, avvisi }) => {
  const { page, avviso } = await apriSegnalata(app, shell);
  const barra = await barraPage(app);
  await comandaBarra(app, 'tasto');
  await pannelloFermo(barra);
  const x = 56 + 8;
  await nellaVista(app, 'barra', [
    { type: 'mouseMove', x, y: 200 },
    { type: 'mouseWheel', x, y: 200, deltaX: 0, deltaY: -400 },
    ...clic(x, 200, 'right'),
  ]);
  await comandaBarra(app, 'tasto');
  await pannelloFermo(barra);
  await nellaVista(app, 'barra', [{ type: 'mouseMove', x, y: 260 }, ...clic(x, 260)]);
  // Il clic finisce su quello che l'utente vede: l'avviso, che resta.
  await expect.poll(() => avviso.evaluate(() => window.__g)).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(false);

  // Gli avvisi in basso a destra: il loro margine, fuori dalle carte, è dell'avviso del sito anche lui.
  await shell.evaluate(() => window.filoNotify('Bloccato popup', { durationSec: 0, actions: [{ label: 'Apri', onClick: () => {} }] }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  const m = await vista.evaluate(() => {
    for (let y = innerHeight - 1; y > 0; y--) for (let x = innerWidth - 1; x > 0; x -= 4) {
      if (!document.elementFromPoint(x, y)?.closest('.shell-notif')) return { x, y };
    }
    return null;
  });
  expect(m).not.toBeNull();
  const primaAvviso = await avviso.evaluate(() => window.__g);
  await nellaVista(app, 'avvisi', [{ type: 'mouseMove', ...m }, { type: 'mouseWheel', ...m, deltaX: 0, deltaY: -400, canScroll: true }, ...clic(m.x, m.y)]);
  await expect.poll(() => avviso.evaluate(() => window.__g)).toBeGreaterThan(primaAvviso);

  await page.waitForTimeout(400);
  expect(await coperta(app)).toBe(true);
  expect(await page.evaluate(() => window.__g)).toEqual({ giu: 0, clic: 0, rotella: 0 });
});
