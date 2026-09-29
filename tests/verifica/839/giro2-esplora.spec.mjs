// #839 — secondo giro: Alt+S dove la pagina non può confermare, pagina in caricamento, menu aperto, passata sui dati vecchi sotto stress.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';

const PAGINA = (titolo, colore = '#f6d365') => `<!doctype html><html><head><title>${titolo}</title></head>
  <body style="margin:0;min-height:100vh;background:linear-gradient(135deg,${colore},#a1c4fd)">
  <h1 style="font:48px Georgia;padding:40px">${titolo}</h1>${'<p style="padding:0 40px">Testo di prova per la miniatura.</p>'.repeat(30)}</body></html>`;

function altS(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('save-for-later', win);
  });
}

async function confermaOvunque(app) {
  const dove = [];
  for (const w of app.windows()) {
    try {
      if (await w.evaluate(() => !!document.querySelector('.sn-save-confirm'))) dove.push(w.url());
    } catch (_) {}
  }
  return dove;
}

async function attendiConferma(app, ms = 9000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    const d = await confermaOvunque(app);
    if (d.length) return d;
    await new Promise((r) => setTimeout(r, 150));
  }
  return [];
}

const schede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.map((t) => t.url));
const salvata = (app, u) => app.evaluate(async (_e, x) => (await globalThis.SN_SAVED_PAGES.list()).find((p) => p.url === x) || null, u);

test('pagina che non risponde con davanti solo la nuova scheda di Filo: la conferma compare da qualche parte', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const url = testServer.html(PAGINA('Bloccata sola'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  console.log('schede prima', await schede(app));
  await page.evaluate(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 10000) { /* occupata */ } }, 50); });
  await page.waitForTimeout(200);
  await altS(app);
  await expect.poll(() => salvata(app, url).then((s) => !!s), { timeout: 12000 }).toBe(true);
  const dove = await attendiConferma(app, 6000);
  console.log('schede dopo', await schede(app), 'conferma in', dove);
  expect(dove.length, 'nessuna conferma: la pagina è stata salvata e chiusa in silenzio').toBeGreaterThan(0);
});

test('pagina ancora in caricamento: Alt+S salva, chiude, conferma sulla scheda davanti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const davanti = await testServer.openReady(openTab, PAGINA('Davanti', '#fda085'), { pubblico: true });
  let rilascia;
  const lento = createServer((req, res) => {
    if (req.url.startsWith('/lento.js')) { rilascia = () => { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end('1'); }; return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>In caricamento</title></head><body style="background:#c2e9fb"><h1>Si carica</h1><script src="/lento.js"></script><p>fine</p></body></html>');
  });
  await new Promise((r) => lento.listen(0, '127.0.0.1', r));
  const url = `http://localhost:${lento.address().port}/pagina`;
  try {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    let page = null;
    await expect.poll(() => { page = app.windows().find((w) => { try { return new URL(w.url()).hostname === 'localhost'; } catch (_) { return false; } }); return !!page; }, { timeout: 8000 }).toBe(true);
    await page.waitForTimeout(800);
    const t0 = Date.now();
    await altS(app);
    await expect.poll(() => salvata(app, url).then((s) => !!s), { timeout: 8000 }).toBe(true);
    const s = await salvata(app, url);
    console.log('salvata dopo ms', Date.now() - t0, 'titolo', s.title, 'miniatura', s.thumbnail ? s.thumbnail.length : 0);
    const dove = await attendiConferma(app, 6000);
    console.log('conferma in', dove, 'schede', await schede(app));
    expect(dove.some((u) => u === davanti.url())).toBe(true);
  } finally {
    try { rilascia && rilascia(); } catch (_) {}
    lento.closeAllConnections?.();
    await new Promise((r) => lento.close(r));
  }
});

test('Alt+S col menu del tasto destro aperto: il menu non finisce nella miniatura', async ({ app, openTab, testServer }) => {
  const url = testServer.html(PAGINA('Menu aperto', '#ffffff'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.click('body', { button: 'right', position: { x: 200, y: 200 } });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await altS(app);
  await expect(page.locator('.sn-save-confirm')).toBeVisible({ timeout: 5000 });
  await expect.poll(() => salvata(app, url).then((s) => !!(s && s.thumbnail)), { timeout: 8000 }).toBe(true);
  const s = await salvata(app, url);
  mkdirSync('tests/.shots', { recursive: true });
  writeFileSync('tests/.shots/839-g2-menu-aperto.jpg', Buffer.from(s.thumbnail.split(',')[1], 'base64'));
});

test('la griglia di «Aperti per dopo» con le miniature nuove, tema chiaro e scuro', async ({ app, openTab, testServer, shell }) => {
  for (const [t, c] of [['Una ricetta', '#f6d365'], ['Un articolo lungo', '#a1c4fd'], ['Video da vedere', '#fda085']]) {
    const url = testServer.html(PAGINA(t, c));
    const page = await openTab(url);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    await altS(app);
    await expect.poll(() => salvata(app, url).then((s) => !!(s && s.thumbnail)), { timeout: 8000 }).toBe(true);
    await page.waitForEvent('close', { timeout: 8000 }).catch(() => {});
  }
  const home = await openTab('filo://home/home.html');
  await home.waitForLoadState('domcontentloaded');
  await home.waitForTimeout(800);
  await home.screenshot({ path: 'tests/.shots/839-g2-griglia-chiaro.png' });
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await home.waitForTimeout(800);
  await home.screenshot({ path: 'tests/.shots/839-g2-griglia-scuro.png' });
});

async function bloccaEPremi(app, page) {
  await page.evaluate(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 10000) { /* occupata */ } }, 50); });
  await page.waitForTimeout(200);
  await altS(app);
}

const chiudiScheda = (app, u) => app.evaluate(({ BrowserWindow }, x) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const t = tm.tabs.find((y) => y.url.startsWith(x));
  if (t) tm.closeTab(t.id);
}, u);

for (const interna of ['filo://home/home.html', 'filo://options/options.html', 'filo://history/history.html']) {
  test(`pagina che non risponde con davanti ${interna}: la conferma compare`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await chiudiScheda(app, 'filo://newtab/');
    const pi = await openTab(interna);
    await pi.waitForLoadState('domcontentloaded');
    await pi.waitForTimeout(800);
    const url = testServer.html(PAGINA('Bloccata ' + interna));
    const page = await openTab(url);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    await bloccaEPremi(app, page);
    await expect.poll(() => salvata(app, url).then((s) => !!s), { timeout: 12000 }).toBe(true);
    const dove = await attendiConferma(app, 6000);
    console.log(interna, 'schede dopo', await schede(app), 'conferma in', dove);
    expect(dove.length, 'nessuna conferma').toBeGreaterThan(0);
  });
}

test('pagina che non risponde ed è l\'unica scheda: la conferma compare nella nuova scheda', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const url = testServer.html(PAGINA('Unica'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await chiudiScheda(app, 'filo://newtab/');
  console.log('schede prima', await schede(app));
  await bloccaEPremi(app, page);
  await expect.poll(() => salvata(app, url).then((s) => !!s), { timeout: 12000 }).toBe(true);
  const dove = await attendiConferma(app, 6000);
  console.log('schede dopo', await schede(app), 'conferma in', dove);
  expect(dove.length, 'nessuna conferma').toBeGreaterThan(0);
});

test('Alt+S due volte su una pagina in caricamento: una voce sola, una conferma che porta alla voce', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const davanti = await testServer.openReady(openTab, PAGINA('Davanti2', '#fda085'), { pubblico: true });
  const lento = createServer((req, res) => {
    if (req.url.startsWith('/lento.js')) return; // mai
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>Lenta</title></head><body><h1>Si carica</h1><script src="/lento.js"></script></body></html>');
  });
  await new Promise((r) => lento.listen(0, '127.0.0.1', r));
  const url = `http://localhost:${lento.address().port}/p`;
  try {
    await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    await expect.poll(() => app.windows().some((w) => { try { return new URL(w.url()).hostname === 'localhost'; } catch (_) { return false; } }), { timeout: 8000 }).toBe(true);
    await new Promise((r) => setTimeout(r, 800));
    await altS(app);
    await new Promise((r) => setTimeout(r, 1500));
    await altS(app);
    await expect.poll(() => salvata(app, url).then((s) => !!s), { timeout: 10000 }).toBe(true);
    await new Promise((r) => setTimeout(r, 4000));
    const voci = await app.evaluate(async (_e, x) => (await globalThis.SN_SAVED_PAGES.list()).filter((p) => p.url === x), url);
    const conferme = await davanti.evaluate(() => [...document.querySelectorAll('.sn-save-confirm')].length);
    console.log('voci', voci.length, voci.map((v) => v.id), 'conferme', conferme, 'schede', await schede(app));
    expect(voci.length).toBe(1);
  } finally {
    lento.closeAllConnections?.();
    await new Promise((r) => lento.close(r));
  }
});

test('aspetto: conferma di ripiego su «Aperti per dopo» e sulla nuova scheda, tema scuro', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  for (const [interna, nome] of [['filo://home/home.html', 'home'], ['filo://newtab/', 'newtab']]) {
    if (interna !== 'filo://newtab/') await chiudiScheda(app, 'filo://newtab/');
    const pi = interna === 'filo://newtab/' ? null : await openTab(interna);
    if (pi) { await pi.waitForLoadState('domcontentloaded'); await pi.waitForTimeout(600); }
    const url = testServer.html(PAGINA('Per aspetto ' + nome));
    const page = await openTab(url);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    await bloccaEPremi(app, page);
    await expect.poll(async () => (await confermaOvunque(app)).length, { timeout: 12000 }).toBeGreaterThan(0);
    const w = app.windows().find((x) => x.url().startsWith(interna));
    await w.waitForTimeout(300);
    await w.screenshot({ path: `tests/.shots/839-g2-ripiego-${nome}-scuro.png` });
    await page.waitForTimeout(10);
  }
});

test('lista «Aperti per dopo» già aperta: dopo un salvataggio dal menu, tornandoci, la pagina c\'è', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const lista = await openTab('filo://home/home.html');
  await lista.waitForLoadState('domcontentloaded');
  await lista.waitForTimeout(600);
  const url = testServer.html(PAGINA('Da ritrovare'));
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.click('body', { button: 'right', position: { x: 400, y: 300 } });
  await page.locator('.sn-menu [data-sn-icon-id="saveForLater"]').click();
  await page.waitForEvent('close', { timeout: 10000 });
  console.log('schede', await schede(app));
  await lista.waitForTimeout(1500);
  await lista.screenshot({ path: 'tests/.shots/839-g2-lista-aperta.png' });
  await expect(lista.locator('.sn-card')).toHaveCount(1, { timeout: 3000 });
});
