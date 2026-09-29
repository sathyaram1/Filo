// #824 giro 2: riquadri senza indirizzo proprio.

import { test, expect } from '../../fixtures/electron.mjs';

async function apriEsatta(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  return page;
}

const moduloDi = (shell, title) => shell.evaluate(async (t) => {
  const s = await window.filoShell.tabs.snapshot();
  const tab = s.tabs.find((x) => x.title === t);
  return tab ? tab.formDirty : null;
}, title);

const CASI = {
  'about:blank + document.write, corpo modificabile': `<iframe id="f" style="width:500px;height:200px"></iframe>
    <script>const d = f.contentDocument; d.open(); d.write('<!doctype html><html><body contenteditable="true" style="min-height:150px"></body></html>'); d.close();</script>`,
  'about:blank + textarea aggiunta dal DOM': `<iframe id="f" style="width:500px;height:200px"></iframe>
    <script>const t = f.contentDocument.createElement('textarea'); t.id = 'x'; f.contentDocument.body.appendChild(t);</script>`,
  'src javascript vuoto + document.write': `<iframe id="f" src="javascript:''" style="width:500px;height:200px"></iframe>
    <script>setTimeout(() => { const d = f.contentDocument; d.open(); d.write('<body contenteditable=true style=min-height:150px></body>'); d.close(); }, 100);</script>`,
  'blob: (editor a blocchi)': `<iframe id="f" style="width:500px;height:200px"></iframe>
    <script>f.src = URL.createObjectURL(new Blob(['<!doctype html><body><div contenteditable=true style=min-height:150px id=x></div></body>'], { type: 'text/html' }));</script>`,
};

for (const [nome, corpo] of Object.entries(CASI)) {
  test(`riquadro ${nome}`, async ({ app, shell, testServer }) => {
    const page = await apriEsatta(app, shell, testServer.html(`<!doctype html><html><head><title>R</title></head><body>${corpo}</body></html>`));
    await page.waitForTimeout(600);
    const fr = page.frameLocator('#f');
    const bersaglio = (await fr.locator('#x').count()) ? fr.locator('#x') : fr.locator('body');
    await bersaglio.click();
    await page.keyboard.type('Testo scritto nel riquadro');
    await page.waitForTimeout(1500);
    const f = page.frames().find((x) => x !== page.mainFrame());
    const info = await f.evaluate(() => ({
      url: location.href,
      testo: (document.getElementById('x')?.value ?? document.getElementById('x')?.textContent ?? document.body.textContent),
      filo: document.documentElement.dataset.filoReady || null,
      attrs: [...document.documentElement.attributes].map((a) => a.name).join(','),
    }));
    console.log('CASO', nome, JSON.stringify(info), 'formDirty', await moduloDi(shell, 'R'));
  });
}
