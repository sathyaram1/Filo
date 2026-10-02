// #686.1 giro 9 — esplorazione: riquadri incorporati di forma insolita, documento sostituito da un indirizzo javascript:, clic centrale su Linux in un componente chiuso.
// Gesti mandati come quelli del sistema (sendInputEvent), misura vera della scheda.

import { test, expect } from '../../fixtures/electron.mjs';

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

const tasto = (keyCode) => [
  { type: 'keyDown', keyCode, modifiers: ['control'] },
  { type: 'keyUp', keyCode, modifiers: ['control'] },
];
const colpo = { type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: 120, wheelTicksY: 1, canScroll: true, modifiers: ['control'] };
const pizzico = { type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: 4, canScroll: true, hasPreciseScrollingDeltas: true, modifiers: ['control'] };
const muovi = { type: 'mouseMove', x: 300, y: 300 };
const sinistro = [
  { type: 'mouseDown', x: 300, y: 300, button: 'left', clickCount: 1 },
  { type: 'mouseUp', x: 300, y: 300, button: 'left', clickCount: 1 },
];
const medio = [
  { type: 'mouseDown', x: 300, y: 300, button: 'middle', clickCount: 1 },
  { type: 'mouseUp', x: 300, y: 300, button: 'middle', clickCount: 1 },
];

async function provaGesti(app, page, nome) {
  const esiti = {};
  await manda(app, page, [muovi]);
  await page.waitForTimeout(200);
  await manda(app, page, sinistro);
  await page.waitForTimeout(200);
  await manda(app, page, tasto('='));
  await page.waitForTimeout(500);
  esiti.tasti = await percentOf(app, page);
  await manda(app, page, tasto('0'));
  await page.waitForTimeout(400);

  await manda(app, page, [colpo]);
  await page.waitForTimeout(600);
  esiti.ctrlRotella = await percentOf(app, page);
  await manda(app, page, tasto('0'));
  await page.waitForTimeout(400);

  for (let i = 0; i < 10; i++) { await manda(app, page, [pizzico]); await page.waitForTimeout(30); }
  await page.waitForTimeout(500);
  esiti.pizzico = await percentOf(app, page);
  await manda(app, page, tasto('0'));
  await page.waitForTimeout(400);

  await manda(app, page, medio);
  await page.waitForTimeout(600);
  esiti.riquadro = await page.locator('#__filo-zoom-badge').isVisible().catch(() => false);
  esiti.modalita = await page.evaluate(() => document.documentElement.dataset.filoZoomMode || '');
  if (esiti.riquadro) {
    await manda(app, page, [{ type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: -120, wheelTicksY: -1, canScroll: true }]);
    await page.waitForTimeout(600);
    esiti.rotellaInModalita = await percentOf(app, page);
    await manda(app, page, sinistro);
    await page.waitForTimeout(400);
    esiti.chiusoColClic = !(await page.locator('#__filo-zoom-badge').isVisible().catch(() => false));
  }
  console.log(`[giro9] ${nome}: ${JSON.stringify(esiti)}`);
  expect.soft(esiti.tasti, `${nome}: Ctrl+ non zooma`).toBeGreaterThan(100);
  expect.soft(esiti.ctrlRotella, `${nome}: Ctrl+rotella non zooma`).toBeGreaterThan(100);
  expect.soft(esiti.pizzico, `${nome}: il pizzico non zooma`).not.toBe(100);
  expect.soft(esiti.riquadro, `${nome}: la rotella premuta non apre il riquadro`).toBe(true);
  return esiti;
}

const CONTENUTO = '<!doctype html><html><body style="margin:0;height:3000px;font:20px sans-serif"><h2 id=c>il contenuto vero</h2><p>testo</p></body></html>';
const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

for (const [nome, sandbox] of [
  ['srcdoc', null],
  ['srcdoc isolato con script', 'allow-scripts'],
  ['srcdoc stessa origine senza script (posta)', 'allow-same-origin allow-popups'],
  ['srcdoc isolato senza script', ''],
]) {
  test(`riquadro ${nome}: dopo un clic sul contenuto lo zoom risponde`, async ({ app, openTab, testServer }) => {
    const sb = sandbox == null ? '' : ` sandbox="${sandbox}"`;
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
      <iframe id=f${sb} srcdoc="${attr(CONTENUTO)}" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`);
    await expect(page.frameLocator('#f').locator('#c')).toBeVisible();
    await provaGesti(app, page, nome);
  });
}

test('riquadro di un indirizzo vero ma isolato (sandbox con script): dopo un clic sul contenuto lo zoom risponde', async ({ app, openTab, testServer }) => {
  const src = testServer.html(CONTENUTO);
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
    <iframe id=f sandbox="allow-scripts" src="${src}" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`);
  await expect(page.frameLocator('#f').locator('#c')).toBeVisible();
  await provaGesti(app, page, 'sandbox url');
});

test('riquadro data:: dopo un clic sul contenuto lo zoom risponde', async ({ app, openTab, testServer }) => {
  const src = 'data:text/html;charset=utf-8,' + encodeURIComponent(CONTENUTO);
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
    <iframe id=f src="${src}" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`);
  await expect(page.frameLocator('#f').locator('#c')).toBeVisible();
  await provaGesti(app, page, 'data');
});

test('documento sostituito da un indirizzo javascript:: i gesti restano dell\'utente', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><body><h1>x</h1></body></html>');
  await page.evaluate(() => {
    location.href = 'javascript:"<!doctype html><html><body style=\\"height:4000px\\"><h1 id=t>sostituita</h1></body></html>"';
  });
  await page.waitForFunction(() => !!document.getElementById('t'), null, { timeout: 5000 });
  await provaGesti(app, page, 'javascript:');
});

for (const modo of ['open', 'closed']) {
  test(`Linux: clic centrale in un campo dentro un componente ${modo}: incolla, non apre lo zoom`, async ({ openTab, testServer }) => {
    test.skip(process.platform === 'win32' || process.platform === 'darwin', 'solo Linux');
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
      <p id=s style="font:20px sans-serif;margin:0;padding:10px">ciaomondo</p>
      <div id=host style="position:absolute;left:0;top:100px"></div>
      <script>const r = document.getElementById('host').attachShadow({ mode: '${modo}' }); r.innerHTML = '<textarea id=t style="width:400px;height:200px"></textarea>'; window.__ta = r.querySelector('textarea');</script>
      </body></html>`);
    await page.mouse.dblclick(40, 22);
    await page.mouse.click(100, 200, { button: 'middle' });
    await page.waitForTimeout(500);
    const valore = await page.evaluate(() => window.__ta.value);
    const badge = await page.locator('#__filo-zoom-badge').isVisible().catch(() => false);
    console.log(`[giro9] componente ${modo}: valore=${JSON.stringify(valore)} riquadro=${badge}`);
    expect.soft(valore).toBe('ciaomondo');
    expect.soft(badge).toBe(false);
  });
}
