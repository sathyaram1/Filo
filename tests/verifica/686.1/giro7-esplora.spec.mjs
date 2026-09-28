// #686.1 giro 7 — esplorazione: altre porte della stessa causa.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function wcDi(app, url) {
  return app.evaluate(({ webContents }, u) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here === u) return wc.id;
    }
    return null;
  }, url);
}
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
async function manda(app, page, eventi) {
  const url = await page.evaluate(() => location.href);
  await app.evaluate(({ webContents }, { u, eventi }) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here !== u) continue;
      for (const ev of eventi) wc.sendInputEvent(ev);
    }
  }, { u: url, eventi });
}
const tasto = (keyCode, modifiers = ['control']) => [
  { type: 'keyDown', keyCode, modifiers },
  { type: 'char', keyCode, modifiers },
  { type: 'keyUp', keyCode, modifiers },
];
const colpo = (v = 1) => ({ type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: 120 * v, wheelTicksY: v, canScroll: true, modifiers: ['control'] });
const rotella = { type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: -120, wheelTicksY: -1, canScroll: true, modifiers: [] };
const clic = (x, y, button = 'left') => [
  { type: 'mouseDown', x, y, button, clickCount: 1 },
  { type: 'mouseUp', x, y, button, clickCount: 1 },
];

async function sonda(app, page, nome) {
  const r = {};
  await manda(app, page, clic(300, 300));
  await page.waitForTimeout(300);
  await manda(app, page, tasto('='));
  await page.waitForTimeout(500);
  r.tasto = await percentOf(app, page);
  await manda(app, page, tasto('0'));
  await page.waitForTimeout(500);
  r.reset = await percentOf(app, page);
  await manda(app, page, [colpo(1)]);
  await page.waitForTimeout(600);
  r.ctrlRotella = await percentOf(app, page);
  await manda(app, page, tasto('0'));
  await page.waitForTimeout(400);
  await manda(app, page, clic(300, 300, 'middle'));
  await page.waitForTimeout(600);
  r.riquadro = await page.locator('#__filo-zoom-badge').isVisible().catch(() => false);
  r.modo = await page.evaluate(() => document.documentElement.dataset.filoZoomMode || '');
  if (r.modo) {
    await manda(app, page, [rotella]);
    await page.waitForTimeout(500);
    r.rotellaInModo = await percentOf(app, page);
  }
  console.log('SONDA', nome, JSON.stringify(r));
  return r;
}

const PIENO = 'border:0;position:fixed;inset:0;width:100vw;height:100vh';

for (const sb of ['allow-same-origin', '', 'allow-scripts', 'allow-scripts allow-same-origin']) {
  test(`riquadro sandbox="${sb}"`, async ({ app, openTab, testServer }) => {
    const dentro = testServer.html('<!doctype html><html><body style="margin:0;height:3000px"><h2>contenuto</h2><p>testo</p></body></html>');
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0"><iframe sandbox="${sb}" src="${dentro}" style="${PIENO}"></iframe></body></html>`);
    await page.waitForTimeout(1200);
    const r = await sonda(app, page, `sandbox="${sb}"`);
    expect.soft(r.tasto).toBe(110);
    expect.soft(r.ctrlRotella).toBeGreaterThan(100);
    expect.soft(r.riquadro).toBe(true);
  });
}

test('documento sostituito da un indirizzo javascript:', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="height:4000px"><h1>x</h1></body></html>');
  const prima = await page.evaluate(() => location.href);
  await page.evaluate(() => { location.href = "javascript:'<!doctype html><html><body style=\"height:4000px\"><h1>nuova</h1></body></html>'"; });
  await page.waitForTimeout(1500);
  console.log('URL', prima, await page.evaluate(() => location.href), await page.evaluate(() => document.body && document.body.innerHTML.slice(0, 80)));
  const r = await sonda(app, page, 'javascript:');
  expect.soft(r.tasto).toBe(110);
  expect.soft(r.ctrlRotella).toBeGreaterThan(100);
  expect.soft(r.riquadro).toBe(true);
});

for (const tag of ['object', 'embed']) {
  test(`contenuto in un ${tag} di un altro sito`, async ({ app, openTab, testServer }) => {
    const dentro = testServer.html('<!doctype html><html><body style="margin:0;height:3000px"><h2>contenuto</h2></body></html>').replace('127.0.0.1', 'localhost');
    const el = tag === 'object' ? `<object type="text/html" data="${dentro}" style="${PIENO}"></object>` : `<embed type="text/html" src="${dentro}" style="${PIENO}">`;
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">${el}</body></html>`);
    await page.waitForTimeout(1500);
    const r = await sonda(app, page, tag);
    expect.soft(r.tasto).toBe(110);
    expect.soft(r.ctrlRotella).toBeGreaterThan(100);
    expect.soft(r.riquadro).toBe(true);
  });
}

test('documento XML aperto da solo', async ({ app, openTab }) => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/xml' });
    res.end('<?xml version="1.0"?><rss version="2.0"><channel><title>feed</title>' + '<item><title>voce</title></item>'.repeat(80) + '</channel></rss>');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const page = await openTab(`http://127.0.0.1:${server.address().port}/feed.xml`);
    await page.waitForTimeout(1500);
    const r = await sonda(app, page, 'xml');
    expect.soft(r.riquadro).toBe(true);
  } finally { server.close(); }
});

test('riquadro di un altro sito: rotella premuta, numero battuto, poi Esc e la rotella scorre di nuovo', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html('<!doctype html><html><body style="margin:0;height:5000px"><h2>contenuto</h2></body></html>').replace('127.0.0.1', 'localhost');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0"><iframe src="${dentro}" style="${PIENO}"></iframe></body></html>`);
  await page.waitForTimeout(1500);
  await manda(app, page, clic(300, 300));
  await manda(app, page, clic(300, 300, 'middle'));
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  await page.locator('#__filo-zoom-percent').click();
  await page.keyboard.type('150');
  await page.keyboard.press('Enter');
  await expect.poll(async () => percentOf(app, page)).toBe(150);
  await page.keyboard.press('Escape');
  await expect(page.locator('#__filo-zoom-badge')).toHaveCount(0);
  const fr = page.frames().find((f) => f.url().includes('localhost'));
  const y0 = await fr.evaluate(() => scrollY);
  for (let i = 0; i < 3; i++) { await manda(app, page, [{ ...rotella, deltaY: 120, wheelTicksY: 1 }]); await page.waitForTimeout(150); }
  await page.waitForTimeout(500);
  const y1 = await fr.evaluate(() => scrollY);
  console.log('SCROLL', y0, y1, await percentOf(app, page));
  expect.soft(y1).toBeGreaterThan(y0);
  expect.soft(await percentOf(app, page)).toBe(150);
});

test('mentre si batte il numero, le scorciatoie di Filo', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="height:4000px"><h1>x</h1></body></html>');
  const schede = () => app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return win._filoTabs.tabs.length;
  });
  const n0 = await schede();
  await manda(app, page, clic(300, 300, 'middle'));
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  await page.locator('#__filo-zoom-percent').click();
  await manda(app, page, tasto('T'));
  await page.waitForTimeout(1500);
  const n1 = await schede();
  console.log('SCHEDE in modifica', n0, n1);
});

test('stessa scorciatoia senza riquadro', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="height:4000px"><h1>x</h1></body></html>');
  const schede = () => app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return win._filoTabs.tabs.length;
  });
  const n0 = await schede();
  await manda(app, page, clic(300, 300));
  await manda(app, page, tasto('T'));
  await page.waitForTimeout(1500);
  const n1 = await schede();
  console.log('SCHEDE normale', n0, n1);
});
