import fs from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';

const pagina = (colore, titolo) => `<!doctype html><title>${titolo}</title><style>html,body{margin:0;height:100%;background:${colore}}</style><h1 style="padding:40px;font:40px sans-serif">contenuto</h1>`;

async function schede(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    return { attiva: t.activeId, tutte: t.tabs.map((x) => ({ id: x.id, url: x.url, title: x.title, loading: x.loading, foto: !!t.anteprime.get(x.id) })) };
  });
}
async function apri(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let id;
  await expect.poll(async () => { const t = (await schede(app)).tutte.find((x) => x.url === url); id = t && !t.loading ? t.id : null; return !!id; }, { timeout: 15000 }).toBe(true);
  return id;
}
async function cartaInfo(app, file) {
  return app.evaluate(async ({ BrowserWindow }, file) => {
    const c = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL() === 'filo://shell/anteprima.html');
    if (!c) return { esiste: false };
    const dom = await c.webContents.executeJavaScript(`({mostrata: !document.getElementById('carta').hidden, titolo: document.getElementById('titolo').innerHTML, html: document.body.innerHTML.length, img: !!document.querySelector('#foto img')})`);
    let png = null; if (file && c.isVisible()) { const s = await c.webContents.capturePage(); png = s.toPNG().toString('base64'); }
    const main = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    return { esiste: true, png, visibile: c.isVisible(), bounds: c.getBounds(), parent: main.getContentBounds(), ...dom };
  }, file).then((r) => { if (r.png) fs.writeFileSync(file, Buffer.from(r.png, 'base64')); delete r.png; return r; });
}

test('esplora: tema chiaro, scuro, titolo strano, ultima scheda a destra, chiusura della scheda puntata', async ({ app, shell, testServer }) => {
  const a = await apri(app, shell, testServer.html(pagina('#e01010', '<img src=x onerror=alert(1)> 🍕 titolo lunghissimo '.repeat(6))));
  await new Promise((r) => setTimeout(r, 400));
  const ids = [a];
  for (let i = 0; i < 12; i++) ids.push(await apri(app, shell, testServer.html(pagina('#1030e0', 'Blu ' + i))));
  await expect.poll(async () => (await schede(app)).tutte.find((x) => x.id === a).foto, { timeout: 10000 }).toBe(true);
  await shell.locator(`.tab[data-id="${a}"]`).hover();
  await expect.poll(async () => (await cartaInfo(app)).visibile, { timeout: 3000 }).toBe(true);
  const chiaro = await cartaInfo(app, 'tests/.shots/430-g7-chiaro.png');
  console.log('CHIARO', JSON.stringify(chiaro));
  await shell.screenshot({ path: 'tests/.shots/430-g7-shell-chiaro.png' });
  await shell.locator('#tab-new').hover();
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await shell.emulateMedia({ colorScheme: 'dark' });
  await new Promise((r) => setTimeout(r, 500));
  await shell.locator(`.tab[data-id="${a}"]`).hover();
  await expect.poll(async () => (await cartaInfo(app)).visibile, { timeout: 3000 }).toBe(true);
  console.log('SCURO', JSON.stringify(await cartaInfo(app, 'tests/.shots/430-g7-scuro.png')));
  // ultima a destra (penultima: l'ultima è attiva)
  const pen = ids[ids.length - 2];
  await shell.locator(`.tab[data-id="${pen}"]`).hover();
  await new Promise((r) => setTimeout(r, 400));
  console.log('DESTRA', JSON.stringify(await cartaInfo(app, 'tests/.shots/430-g7-destra.png')));
  // chiudi con clic centrale la scheda puntata
  await shell.locator(`.tab[data-id="${pen}"]`).click({ button: 'middle' });
  await new Promise((r) => setTimeout(r, 600));
  console.log('DOPO-CHIUSURA', JSON.stringify(await cartaInfo(app)), JSON.stringify((await schede(app)).tutte.length));
  // la scheda che ora sta sotto il puntatore
  await new Promise((r) => setTimeout(r, 600));
  console.log('DOPO-CHIUSURA2', JSON.stringify(await cartaInfo(app)));
  // Ctrl+W mentre la carta è aperta su un'altra scheda
  await shell.locator(`.tab[data-id="${ids[3]}"]`).hover();
  await new Promise((r) => setTimeout(r, 400));
  console.log('PRIMA-CTRLW', JSON.stringify(await cartaInfo(app)));
  await shell.keyboard.press('Control+w');
  await new Promise((r) => setTimeout(r, 600));
  console.log('DOPO-CTRLW', JSON.stringify(await cartaInfo(app)), (await schede(app)).attiva);
  await shell.keyboard.press('Control+Tab');
  await new Promise((r) => setTimeout(r, 600));
  console.log('DOPO-CTRLTAB', JSON.stringify(await cartaInfo(app)), (await schede(app)).attiva);
});
