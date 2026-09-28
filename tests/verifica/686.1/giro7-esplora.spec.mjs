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
  await page.mouse.click(300, 300);
  await page.waitForTimeout(300);
  await manda(app, page, tasto('='));
  await page.waitForTimeout(500);
  r.tasto = await percentOf(app, page);
  await manda(app, page, tasto('0'));
  await page.waitForTimeout(500);
  r.reset = await percentOf(app, page);
  await page.mouse.move(300, 300);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await page.waitForTimeout(600);
  r.ctrlRotella = await percentOf(app, page);
  await manda(app, page, tasto('0'));
  await page.waitForTimeout(400);
  await page.mouse.click(300, 300, { button: 'middle' });
  await page.waitForTimeout(600);
  r.riquadro = await page.locator('#__filo-zoom-badge').isVisible().catch(() => false);
  r.modo = await page.evaluate(() => document.documentElement.dataset.filoZoomMode || '');
  if (r.modo) {
    await page.mouse.wheel(0, -100);
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

for (const variante of ['controllo', 'medio-esc', 'medio-numero-esc', 'medio-medio', 'medio-clic']) {
  test(`scorrimento nel riquadro dopo: ${variante}`, async ({ app, openTab, testServer }) => {
    const dentro = testServer.html(`<!doctype html><html><body style="margin:0;height:5000px"><h2>contenuto</h2><script>
      window.__w = []; addEventListener('wheel', (e) => { __w.push(e.defaultPrevented); }, { capture: true });</script></body></html>`).replace('127.0.0.1', 'localhost');
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0"><iframe src="${dentro}" style="${PIENO}"></iframe></body></html>`);
    await page.waitForTimeout(1500);
    await manda(app, page, clic(300, 300));
    if (variante !== 'controllo') {
      await manda(app, page, clic(300, 300, 'middle'));
      await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
      if (variante === 'medio-numero-esc') {
        await page.locator('#__filo-zoom-percent').click();
        await page.keyboard.type('150');
        await page.keyboard.press('Enter');
        await expect.poll(async () => percentOf(app, page)).toBe(150);
      }
      if (variante.endsWith('esc')) await page.keyboard.press('Escape');
      if (variante === 'medio-medio') await manda(app, page, clic(300, 300, 'middle'));
      if (variante === 'medio-clic') await manda(app, page, clic(300, 300));
      await expect(page.locator('#__filo-zoom-badge')).toHaveCount(0);
    }
    const p0 = await percentOf(app, page);
    const fr = page.frames().find((f) => f.url().includes('localhost'));
    for (let i = 0; i < 3; i++) { await manda(app, page, [rotella]); await page.waitForTimeout(150); }
    await page.waitForTimeout(500);
    const a = await fr.evaluate(() => [scrollY, JSON.stringify(__w)]);
    await page.mouse.move(300, 300);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(500);
    console.log('SCORRE-send', variante, JSON.stringify(a));
    console.log('SCORRE', variante, await fr.evaluate(() => [scrollY, JSON.stringify(__w), document.hasFocus()]), 'zoom', p0, await percentOf(app, page));
  });
}

test('fuoco portato in un riquadro mentre si batte il numero', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="height:4000px"><h1>x</h1>
    <iframe id=f srcdoc="<input id=i>" style="width:300px;height:80px"></iframe><script>
    addEventListener('focusin', (e) => { if (e.target.id === '__filo-zoom-percent') setTimeout(() => { const f = document.getElementById('f'); f.contentWindow.focus(); f.contentDocument.getElementById('i').focus(); }, 0); }, true);
    </script></body></html>`);
  await page.waitForTimeout(800);
  await page.mouse.click(600, 400, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  await page.locator('#__filo-zoom-percent').click();
  await page.waitForTimeout(300);
  await page.keyboard.type('150');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const dove = await page.frames()[1].evaluate(() => document.getElementById('i').value).catch(() => '?');
  console.log('FUOCO', await percentOf(app, page), 'nel riquadro:', dove);
});

test('scheda aperta vuota e scritta dal sito che la apre', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="height:4000px"><button id=b>apri</button><script>
    document.getElementById('b').onclick = () => { const w = window.open(''); if (w) { w.document.write('<!doctype html><html><body style="height:4000px"><h1>scritta dall\\'opener</h1></body></html>'); w.document.close(); } window.__w = !!w; };
    </script></body></html>`);
  await page.click('#b');
  await page.waitForTimeout(2000);
  const urls = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => { try { return w.getURL(); } catch (_) { return '?'; } }));
  console.log('APERTA', await page.evaluate(() => window.__w), JSON.stringify(urls));
  const nuova = app.windows().find((p) => { try { return p.url() === 'about:blank'; } catch (_) { return false; } });
  console.log('PAGINA', !!nuova);
});

const SITI = {
  chiaro: '<!doctype html><html><body style="margin:0;height:4000px;background:#fafafa;font:16px Georgia"><h1 style="margin:20px">Un sito chiaro</h1><p style="margin:20px">testo di esempio</p></body></html>',
  scuro: '<!doctype html><html><head><meta name=color-scheme content=dark></head><body style="margin:0;height:4000px;background:#121212;color:#eee;font:16px sans-serif"><h1 style="margin:20px">Un sito scuro</h1></body></html>',
  dialogo: `<!doctype html><html><head><style>
    dialog { text-transform: uppercase; letter-spacing: 3px; text-align: center; font: 22px serif; color: #222; background: #fff; }
    dialog div { padding: 20px; border: 2px solid red; }
    dialog input { width: 100%; padding: 10px; border: 1px solid #999; background: #fff; color: #000; font-size: 18px; }
  </style></head><body style="height:4000px"><h1>sito con avviso</h1><dialog id=d><div>Accetti i cookie?</div><input placeholder=email></dialog>
  <script>document.getElementById('d').showModal();</script></body></html>`,
  toast: `<!doctype html><html><body style="height:4000px"><h1>sito con notifica</h1>
  <div id=t popover=manual style="position:fixed;inset:auto;top:8px;right:8px;margin:0;width:320px;padding:16px;background:#335;color:#fff">Nuovo messaggio</div></body></html>`,
};
for (const [nome, html] of Object.entries(SITI)) {
  test(`aspetto del riquadro: ${nome}`, async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, html);
    await page.waitForTimeout(600);
    await page.mouse.click(600, 500, { button: 'middle' });
    await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
    if (nome === 'toast') { await page.evaluate(() => document.getElementById('t').showPopover()); await page.waitForTimeout(200); }
    await page.screenshot({ path: `tests/.shots/686-1-giro7-${nome}.png` });
    if (nome === 'dialogo' || nome === 'toast') {
      await page.locator('#__filo-zoom-percent').click({ force: true }).catch(() => {});
      const box = await page.locator('#__filo-zoom-percent').boundingBox();
      if (nome === 'toast') await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.keyboard.type('130');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      console.log('ASPETTO', nome, await percentOf(app, page));
      await page.screenshot({ path: `tests/.shots/686-1-giro7-${nome}-dopo.png` });
    }
  });
}

test('finestra modale fatta di div con trappola del fuoco (come molti avvisi dei cookie)', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="height:4000px"><h1>x</h1>
    <div id=m role=dialog aria-modal=true style="position:fixed;inset:30% 30%;background:#fff;border:1px solid;z-index:99999"><button id=ok>Accetta</button><input id=e></div>
    <script>const m = document.getElementById('m'); document.getElementById('ok').focus();
    document.addEventListener('focusin', (ev) => { if (!m.contains(ev.target)) document.getElementById('ok').focus(); }, true);
    document.addEventListener('mousedown', (ev) => { if (!m.contains(ev.target)) ev.preventDefault(); }, true);
    document.body.style.pointerEvents = 'none'; m.style.pointerEvents = 'auto';
    </script></body></html>`);
  await page.waitForTimeout(500);
  await page.mouse.click(300, 100, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  const box = await page.locator('#__filo-zoom-percent').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.type('130');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  console.log('TRAPPOLA', await percentOf(app, page), await page.evaluate(() => document.getElementById('e').value));
});

test('pagina navigata a un indirizzo blob', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="height:4000px"><h1>x</h1></body></html>');
  await page.evaluate(() => { location.href = URL.createObjectURL(new Blob(['<!doctype html><html><body style="height:4000px"><h1>blob</h1></body></html>'], { type: 'text/html' })); });
  await page.waitForTimeout(2000);
  console.log('BLOB', await page.evaluate(() => location.href));
  if (!(await page.evaluate(() => location.href)).startsWith('blob:')) return;
  const r = await sonda(app, page, 'blob');
  expect.soft(r.tasto).toBe(110);
  expect.soft(r.riquadro).toBe(true);
});

test('documento riscritto: il tasto destro offre ancora la dimensione reale', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="height:4000px"><h1>x</h1></body></html>');
  await page.evaluate(() => { document.open(); document.write('<!doctype html><html><body style="height:4000px"><h1 id=t>riscritta</h1></body></html>'); document.close(); });
  await page.waitForTimeout(500);
  await manda(app, page, tasto('='));
  await manda(app, page, tasto('='));
  await expect.poll(async () => percentOf(app, page)).toBe(120);
  await page.locator('h1').click({ button: 'right' });
  await page.waitForTimeout(800);
  const menu = await page.locator('.sn-menu').isVisible().catch(() => false);
  const voce = await page.locator('.sn-menu').getByText(/Dimensione reale/).count().catch(() => 0);
  console.log('DESTRO riscritta', menu, voce);
});
