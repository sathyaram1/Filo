// #686.1 — giro 3, esplorazione: porte nuove dei gesti dello zoom.

import { test, expect } from '../../fixtures/electron.mjs';

async function suScheda(app, page, src, arg) {
  const url = await page.evaluate(() => location.href);
  return app.evaluate(({ webContents }, { u, src, arg }) => {
    const f = new Function('wc', 'arg', src);
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here === u) return f(wc, arg);
    }
    return null;
  }, { u: url, src, arg });
}
const percentOf = async (app, page) => {
  const f = await suScheda(app, page, 'return wc.getZoomFactor();');
  return f == null ? null : Math.round(f * 100);
};
const manda = (app, page, eventi) => suScheda(app, page, 'for (const ev of arg) wc.sendInputEvent(ev);', eventi);
const tasto = (keyCode) => [
  { type: 'keyDown', keyCode, modifiers: ['control'] },
  { type: 'keyUp', keyCode, modifiers: ['control'] },
];
const scatto = (verso) => ({ type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: 120 * verso, wheelTicksY: verso, canScroll: true, modifiers: ['control'] });
const pizzico = { type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: -4, canScroll: true, hasPreciseScrollingDeltas: true, modifiers: ['control'] };
const rotella = { type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: -120, wheelTicksY: 1, canScroll: true, modifiers: [] };
const medio = [
  { type: 'mouseDown', x: 300, y: 300, button: 'middle', clickCount: 1 },
  { type: 'mouseUp', x: 300, y: 300, button: 'middle', clickCount: 1 },
];

async function misura(app, page, etichetta) {
  const out = {};
  await manda(app, page, tasto('0'));
  await page.waitForTimeout(300);
  await manda(app, page, tasto('='));
  await page.waitForTimeout(400);
  out.tasto = await percentOf(app, page);
  await manda(app, page, tasto('0'));
  await page.waitForTimeout(300);
  await manda(app, page, [scatto(-1)]);
  await page.waitForTimeout(700);
  out.scatto = await percentOf(app, page);
  await manda(app, page, tasto('0'));
  await page.waitForTimeout(1200);
  for (let i = 0; i < 10; i++) { await manda(app, page, [pizzico]); await page.waitForTimeout(30); }
  await page.waitForTimeout(600);
  out.pizzico = await percentOf(app, page);
  await manda(app, page, tasto('0'));
  await page.waitForTimeout(1200);
  await manda(app, page, medio);
  await page.waitForTimeout(500);
  out.medio = await page.locator('#__filo-zoom-badge').isVisible().catch(() => false);
  if (out.medio) {
    await manda(app, page, [rotella]);
    await page.waitForTimeout(400);
    out.rotellaInModalita = await percentOf(app, page);
    await manda(app, page, medio);
    await page.waitForTimeout(300);
  }
  await manda(app, page, tasto('0'));
  await page.waitForTimeout(300);
  console.log('ESITO', etichetta, JSON.stringify(out));
  return out;
}

const pieno = 'border:0;width:100vw;height:100vh;display:block';

test('esplora riquadri insoliti', async ({ app, openTab, testServer }) => {
  test.setTimeout(240000);
  const interno = testServer.html(`<!doctype html><html><body style="margin:0;height:3000px"><h2 style="margin:0">contenuto</h2></body></html>`);
  const altro = interno.replace('127.0.0.1', 'localhost');
  const casi = {
    ombra: `<!doctype html><html><body style="margin:0"><div id="h"></div><script>
      const r = document.getElementById('h').attachShadow({ mode: 'open' });
      const f = document.createElement('iframe'); f.style.cssText = '${pieno}'; r.appendChild(f);
      const d = f.contentDocument; d.open(); d.write('<body contenteditable style="margin:0;height:3000px">scrivi</body>'); d.close();
    </script></body></html>`,
    sandboxAltro: `<!doctype html><html><body style="margin:0"><iframe sandbox="allow-scripts" src="${altro}" style="${pieno}"></iframe></body></html>`,
    sandboxSrcdoc: `<!doctype html><html><body style="margin:0"><iframe sandbox="allow-scripts" srcdoc="<div style='height:3000px'>contenuto</div>" style="${pieno}"></iframe></body></html>`,
    dataUrl: `<!doctype html><html><body style="margin:0"><iframe src="data:text/html,<div style='height:3000px'>contenuto</div>" style="${pieno}"></iframe></body></html>`,
    blobUrl: `<!doctype html><html><body style="margin:0"><script>
      const u = URL.createObjectURL(new Blob(['<div style="height:3000px">contenuto</div>'], { type: 'text/html' }));
      const f = document.createElement('iframe'); f.src = u; f.style.cssText = '${pieno}'; document.body.appendChild(f);
    </script></body></html>`,
  };
  for (const [nome, html] of Object.entries(casi)) {
    const page = await testServer.openReady(openTab, html);
    await page.waitForTimeout(1000);
    await page.mouse.move(10, 10);
    await page.mouse.move(300, 300);
    await page.mouse.click(300, 300);
    await misura(app, page, nome);
  }
});

test('esplora documento riscritto con un indirizzo javascript', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body><h1>x</h1></body></html>`);
  await page.evaluate(() => { location.href = "javascript:'<!doctype html><html><body style=\"height:4000px\"><h1>nuovo</h1></body></html>'"; });
  await page.waitForTimeout(1000);
  console.log('ESITO js-url testo', await page.evaluate(() => document.body.innerText));
  await page.mouse.click(300, 300);
  await misura(app, page, 'javascriptUrl');
});

test('esplora campo cliccato poi rotella poi clic fuori', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="height:4000px"><h1>sito</h1></body></html>`);
  await page.mouse.click(300, 300);
  await manda(app, page, medio);
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  await page.locator('#__filo-zoom-percent').click();
  for (let i = 0; i < 3; i++) { await manda(app, page, [rotella]); await page.waitForTimeout(150); }
  const conRotella = await percentOf(app, page);
  const mostrato = await page.locator('#__filo-zoom-percent').inputValue();
  await page.mouse.click(400, 500);
  await page.waitForTimeout(400);
  console.log('ESITO campo+rotella', JSON.stringify({ conRotella, mostrato, dopoClicFuori: await percentOf(app, page) }));

  await manda(app, page, tasto('0'));
  await page.waitForTimeout(300);
  await manda(app, page, medio);
  await page.locator('#__filo-zoom-percent').click();
  await manda(app, page, tasto('='));
  await manda(app, page, tasto('='));
  await page.waitForTimeout(300);
  const conTasti = await percentOf(app, page);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  console.log('ESITO campo+tasti+invio', JSON.stringify({ conTasti, dopoInvio: await percentOf(app, page) }));

  await manda(app, page, tasto('0'));
  await page.waitForTimeout(300);
  await page.locator('#__filo-zoom-percent').click();
  await page.evaluate(() => navigator.clipboard.writeText('150%')).catch(() => {});
  await app.evaluate(({ clipboard }) => clipboard.writeText('150%'));
  await page.keyboard.press('Control+V');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  console.log('ESITO incolla', await percentOf(app, page));
});

test('esplora scatti rapidi', async ({ app, openTab, testServer }) => {
  const altro = testServer.html(`<!doctype html><html><body style="margin:0;height:3000px">contenuto</body></html>`).replace('127.0.0.1', 'localhost');
  for (const [nome, html] of [
    ['pagina', `<!doctype html><html><body style="height:4000px"><h1>sito</h1></body></html>`],
    ['riquadro', `<!doctype html><html><body style="margin:0"><iframe src="${altro}" style="${pieno}"></iframe></body></html>`],
  ]) {
    const page = await testServer.openReady(openTab, html);
    await page.waitForTimeout(800);
    await page.mouse.click(300, 300);
    for (let i = 0; i < 5; i++) { await manda(app, page, [scatto(-1)]); await page.waitForTimeout(60); }
    await page.waitForTimeout(800);
    const cinque = await percentOf(app, page);
    await manda(app, page, tasto('0'));
    await page.waitForTimeout(1500);
    for (let i = 0; i < 40; i++) { await manda(app, page, [pizzico]); await page.waitForTimeout(16); }
    await page.waitForTimeout(800);
    console.log('ESITO rapidi', nome, JSON.stringify({ cinque, pizzico40: await percentOf(app, page) }));
    await manda(app, page, tasto('0'));
  }
});
