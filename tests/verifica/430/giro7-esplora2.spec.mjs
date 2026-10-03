import fs from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';
async function schede(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    return { attiva: t.activeId, tutte: t.tabs.map((x) => ({ id: x.id, url: x.url, loading: x.loading, foto: !!t.anteprime.get(x.id) })) };
  });
}
async function cartaInfo(app, file) {
  const r = await app.evaluate(async ({ BrowserWindow }, file) => {
    const c = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL() === 'filo://shell/anteprima.html');
    if (!c) return { esiste: false };
    const dom = await c.webContents.executeJavaScript(`({mostrata: !document.getElementById('carta').hidden, titolo: document.getElementById('titolo').textContent, ind: document.getElementById('indirizzo').textContent, fs: getComputedStyle(document.getElementById('titolo')).fontSize, ff: getComputedStyle(document.getElementById('titolo')).fontFamily, zoom: devicePixelRatio, cw: document.getElementById('carta').getBoundingClientRect().width, iw: innerWidth, img: !!document.querySelector('#foto img')})`);
    let png = null; if (file && c.isVisible()) png = (await c.webContents.capturePage()).toPNG().toString('base64');
    return { png, visibile: c.isVisible(), ...dom };
  }, file);
  if (r.png) fs.writeFileSync(file, Buffer.from(r.png, 'base64')); delete r.png; return r;
}
test('esplora: Home e pagine interne', async ({ app, shell, testServer }) => {
  console.log('INIZIO', JSON.stringify(await schede(app)));
  await new Promise((r) => setTimeout(r, 1500));
  await shell.evaluate(() => window.filoShell.tabs.open('filo://history/history.html'));
  await new Promise((r) => setTimeout(r, 1500));
  await shell.evaluate((u) => window.filoShell.tabs.open(u), testServer.html('<title>X</title><body style="background:#0a0">x'));
  await new Promise((r) => setTimeout(r, 2500));
  const s = await schede(app);
  console.log('SCHEDE', JSON.stringify(s));
  for (const t of s.tutte) {
    if (t.id === s.attiva) continue;
    await shell.locator('#tab-new').hover();
    await new Promise((r) => setTimeout(r, 800));
    await shell.locator(`.tab[data-id="${t.id}"]`).hover();
    await new Promise((r) => setTimeout(r, 500));
    console.log('CARTA', t.url, JSON.stringify(await cartaInfo(app, `tests/.shots/430-g7-${s.tutte.indexOf(t)}.png`)));
  }
});
