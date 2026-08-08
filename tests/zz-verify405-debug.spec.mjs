import { test, expect } from './fixtures/electron.mjs';

const CHILD = `<!doctype html><html><body style="margin:0;padding:20px">
  <p id="ptext">Frase dentro il riquadro incorporato abbastanza lunga da spiegare.</p>
  <input id="pinput" value="">
  <textarea id="pta"></textarea></body></html>`;

function parentHtml(u) {
  return `<!doctype html><html><body style="margin:0;padding:30px">
  <p id="outside">fuori</p>
  <p id="mainsel">Frase nel documento principale abbastanza lunga da spiegare.</p>
  <input id="mi" value="">
  <iframe id="f" src="${u}" width="620" height="340"></iframe></body></html>`;
}

async function frameByUrl(page, url) {
  const d = Date.now() + 10000;
  while (Date.now() < d) {
    const f = page.frames().find((x) => x.url() === url && x !== page.mainFrame());
    if (f) return f;
    await page.waitForTimeout(100);
  }
  throw new Error('no frame');
}

const PROBE = () => ({
  cs: document.documentElement.dataset.filoContentScripts,
  ready: document.documentElement.dataset.filoReady,
  spell: typeof globalThis.SN_SPELLCHECK,
  snmenu: typeof globalThis.SN_MENU,
  chrome: typeof globalThis.chrome,
  onMsg: typeof globalThis.chrome?.runtime?.onMessage,
  listeners: globalThis.chrome?.runtime?.onMessage?._listeners?.length ?? null,
});

test('debug: mondo JS main frame vs subframe', async ({ openTab, testServer }) => {
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, parentHtml(childUrl));
  const fr = await frameByUrl(page, childUrl);
  console.log('MAIN  ' + JSON.stringify(await page.evaluate(PROBE)));
  await fr.locator('#ptext').click();
  await page.waitForTimeout(800);
  console.log('CHILD ' + JSON.stringify(await fr.evaluate(PROBE)));
});

test('debug: struttura menu su input (main vs iframe)', async ({ openTab, testServer, app }) => {
  await app.evaluate(({ clipboard }) => clipboard.writeText('APPUNTI-XYZ'));
  const childUrl = testServer.html(CHILD);
  const page = await testServer.openReady(openTab, parentHtml(childUrl));

  await page.locator('#mi').click();
  await page.locator('#mi').click({ button: 'right' });
  await page.waitForTimeout(800);
  const mainHtml = await page.locator('.sn-menu').first().innerHTML().catch((e) => 'ERR ' + e.message);
  console.log('=== MENU MAIN (input) ===\n' + mainHtml.slice(0, 3000));
  await page.keyboard.press('Escape');

  const fr = await frameByUrl(page, childUrl);
  await fr.locator('#pinput').click();
  await fr.locator('#pinput').click({ button: 'right' });
  await page.waitForTimeout(800);
  let sub = 'n/a';
  for (const f of page.frames()) {
    try { if (await f.locator('.sn-menu').count()) { sub = await f.locator('.sn-menu').first().innerHTML(); break; } } catch (_) {}
  }
  console.log('=== MENU IFRAME (input) ===\n' + String(sub).slice(0, 3000));
});

test('debug: dispatch shortcut dal main process', async ({ app }) => {
  const r = await app.evaluate(({ BrowserWindow }) => {
    let how = [];
    try { how.push('typeof require=' + typeof require); } catch (e) { how.push('require throws'); }
    how.push('mainModule=' + (process.mainModule ? 'yes' : 'no'));
    try {
      const m = process.mainModule.require('./src/main/shortcuts.js');
      how.push('loaded=' + Object.keys(m).join(','));
    } catch (e) { how.push('mainModule.require fail: ' + e.message); }
    return how.join(' | ');
  });
  console.log('DISPATCH PROBE: ' + r);
});
