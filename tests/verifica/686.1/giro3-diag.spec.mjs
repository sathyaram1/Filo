// #686.1 — giro 3, diagnosi: scatti in serie e riquadri opachi.

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
const livello = (app, page) => suScheda(app, page, 'return wc.getZoomLevel();');
const manda = (app, page, eventi) => suScheda(app, page, 'for (const ev of arg) wc.sendInputEvent(ev);', eventi);
const tasto = (keyCode) => [
  { type: 'keyDown', keyCode, modifiers: ['control'] },
  { type: 'keyUp', keyCode, modifiers: ['control'] },
];
const scatto = (verso) => ({ type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: 120 * verso, wheelTicksY: verso, canScroll: true, modifiers: ['control'] });

const pieno = 'border:0;width:100vw;height:100vh;display:block';

test('scatti in serie', async ({ app, openTab, testServer }) => {
  test.setTimeout(200000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="height:4000px"><h1>sito</h1></body></html>`);
  await page.waitForTimeout(800);
  await page.mouse.click(300, 300);
  for (const gap of [20, 60, 150, 400, 1100]) {
    for (const verso of [1, -1]) {
      await manda(app, page, tasto('0'));
      await page.waitForTimeout(1500);
      const serie = [];
      for (let i = 0; i < 5; i++) {
        await manda(app, page, [scatto(verso)]);
        await page.waitForTimeout(gap);
        serie.push(Number((await livello(app, page)).toFixed(2)));
      }
      await page.waitForTimeout(1200);
      console.log('ESITO gap', gap, 'verso', verso, JSON.stringify(serie), 'finale', (await livello(app, page)).toFixed(2));
    }
  }
});

test('riquadri opachi', async ({ app, openTab, testServer }) => {
  test.setTimeout(200000);
  const casi = {
    dataUrl: `<!doctype html><html><body style="margin:0"><iframe src="data:text/html,<div style='height:3000px'>contenuto</div>" style="${pieno}"></iframe></body></html>`,
    sandboxSrcdoc: `<!doctype html><html><body style="margin:0"><iframe sandbox="allow-scripts" srcdoc="<div style='height:3000px'>contenuto</div>" style="${pieno}"></iframe></body></html>`,
  };
  for (const [nome, html] of Object.entries(casi)) {
    const page = await testServer.openReady(openTab, html);
    await page.waitForTimeout(1000);
    await page.mouse.click(300, 300);
    const qui = await app.evaluate(({ webContents }) => {
      const out = [];
      for (const wc of webContents.getAllWebContents()) {
        try { for (const f of wc.mainFrame.framesInSubtree) out.push(f.url.slice(0, 40)); } catch (_) {}
      }
      return out;
    });
    console.log('ESITO frames', nome, JSON.stringify(qui.filter((u) => /data:|srcdoc|about/.test(u))));
    const serie = [];
    for (let i = 0; i < 4; i++) {
      await manda(app, page, [scatto(1)]);
      await page.waitForTimeout(1500);
      serie.push(Number((await livello(app, page)).toFixed(2)));
    }
    console.log('ESITO opaco', nome, JSON.stringify(serie));
    await manda(app, page, tasto('0'));
  }
});
