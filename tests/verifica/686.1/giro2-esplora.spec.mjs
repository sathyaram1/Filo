// #686.1 — giro 2: esplorazione di porte vicine.

import { test, expect } from '../../fixtures/electron.mjs';

async function wcDi(app, page) { return page.evaluate(() => location.href); }

async function percentOf(app, page) {
  const url = await wcDi(app, page);
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
  const url = await wcDi(app, page);
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
const medio = [
  { type: 'mouseDown', x: 300, y: 300, button: 'middle', clickCount: 1 },
  { type: 'mouseUp', x: 300, y: 300, button: 'middle', clickCount: 1 },
];

async function tuttiIGesti(app, page, etichetta) {
  await manda(app, page, tasto('='));
  await expect.poll(async () => percentOf(app, page), { timeout: 4000, message: `${etichetta}: Ctrl+=` }).toBe(110);
  await manda(app, page, tasto('0'));
  await expect.poll(async () => percentOf(app, page), { timeout: 4000 }).toBe(100);
  await manda(app, page, [colpo]);
  await page.waitForTimeout(500);
  expect.soft(await percentOf(app, page), `${etichetta}: Ctrl+rotella`).toBeLessThan(100);
  await manda(app, page, tasto('0'));
  await expect.poll(async () => percentOf(app, page), { timeout: 4000 }).toBe(100);
  await manda(app, page, medio);
  await expect.soft(page.locator('#__filo-zoom-badge'), `${etichetta}: rotella premuta`).toBeVisible({ timeout: 3000 });
}

test('A: sito che annulla pointerdown (app a tela)', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;height:3000px">
    <canvas id=c width=800 height=600></canvas>
    <script>window.addEventListener('pointerdown', e => e.preventDefault());</script></body></html>`);
  await page.mouse.move(300, 300);
  await tuttiIGesti(app, page, 'pointerdown annullato');
});

test('B: riquadro srcdoc con sandbox, riquadro data:', async ({ app, openTab, testServer }) => {
  for (const [nome, attr] of [
    ['sandbox srcdoc', `sandbox="allow-scripts" srcdoc="<div style='height:3000px'>contenuto</div>"`],
    ['data', `src="data:text/html,<div style='height:3000px'>contenuto</div>"`],
    ['sandbox vuoto', `sandbox srcdoc="<div style='height:3000px'>contenuto</div>"`],
  ]) {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
      <iframe ${attr} style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`);
    await page.waitForTimeout(800);
    await page.mouse.click(300, 300);
    await tuttiIGesti(app, page, nome);
  }
});

test('C: incolla col tasto destro nel campo', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="height:3000px"><p>x</p></body></html>`);
  await page.mouse.click(300, 300, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  await app.evaluate(({ clipboard }) => clipboard.writeText('150'));
  // Ctrl+V dopo un clic nel campo
  await page.locator('#__filo-zoom-percent').click();
  await page.keyboard.press('Control+v');
  await page.keyboard.press('Enter');
  await expect.poll(async () => percentOf(app, page)).toBe(150);
  await page.locator('#__filo-zoom-percent').click({ button: 'right' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tests/.shots/686.1-g2-destro-campo.png' });
});

test('D: documento riscritto in continuazione', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body><script>
    let n = 0; setInterval(() => { document.open(); document.write('<!doctype html><body style=height:3000px><h1>' + (n++) + '</h1>'); document.close(); }, 150);
  </script></body></html>`);
  await page.mouse.move(300, 300);
  await page.waitForTimeout(1000);
  await tuttiIGesti(app, page, 'riscritto di continuo');
});

test('E: badge in tema e con pagina scura', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="background:#111;color:#eee;height:3000px"><p>scura</p></body></html>`);
  await page.mouse.click(300, 300, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  await page.locator('#__filo-zoom-percent').click();
  await page.keyboard.type('12');
  await page.screenshot({ path: 'tests/.shots/686.1-g2-badge.png' });
});
