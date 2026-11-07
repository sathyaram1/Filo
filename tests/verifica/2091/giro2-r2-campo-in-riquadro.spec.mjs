// Verifica #2091 giro 2, rilievo 2: una scheda lasciata sul campo di testo di un riquadro incorporato nella pagina
// (i commenti di un blog, un editor dentro un frame) ci scrive titolo e indirizzo, come su un campo della pagina.

import { test, expect } from '../../fixtures/electron.mjs';

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);
const idPerUrl = async (shell, url) => (await schede(shell)).find((t) => t.url === url)?.id;

async function lasciaNelRiquadro(app, shell, pagina, frame, sorgente) {
  const r = await frame.locator('#t').evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + Math.min(24, b.width / 2), y: b.top + b.height / 2 };
  });
  const off = await pagina.locator('iframe').first().evaluate((f) => {
    const b = f.getBoundingClientRect();
    return { x: b.left + f.clientLeft, y: b.top + f.clientTop };
  });
  const v = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return { b: t.view.getBounds(), z: t.view.webContents.getZoomFactor() || 1, zs: w.webContents.getZoomFactor() || 1 };
  });
  const verso = { x: (v.b.x + (r.x + off.x) * v.z) / v.zs, y: (v.b.y + (r.y + off.y) * v.z) / v.zs };
  const da = await shell.evaluate((i) => {
    const b = document.querySelector(`.tab[data-id="${i}"]`).getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, sorgente);
  await shell.mouse.move(da.x, da.y);
  await shell.mouse.down();
  await shell.mouse.move(da.x + 8, da.y, { steps: 2 });
  await shell.mouse.move(verso.x, verso.y, { steps: 8 });
  await shell.mouse.up();
}

for (const [nome, pubblico] of [['di un altro sito', true], ['dello stesso sito', false]]) {
  test(`r2 lasciata sul campo di un riquadro ${nome}, ci scrive titolo e indirizzo`, async ({ app, shell, openTab, testServer }) => {
    const sorgenteUrl = testServer.html('<title>Ricetta del pane</title><p>farina');
    await openTab(sorgenteUrl);
    const sorgente = await idPerUrl(shell, sorgenteUrl);
    const dentro = testServer.html('<title>commenti</title><textarea id="t" style="width:300px;height:80px">Commento:</textarea>', { pubblico });
    const pagina = await openTab(testServer.html(`<title>Blog</title><p>articolo</p><iframe src="${dentro}" style="margin:40px;width:400px;height:150px"></iframe>`));
    let frame = null;
    await expect.poll(async () => {
      frame = pagina.frames().find((f) => f.url() === dentro) || null;
      return frame ? frame.locator('#t').count() : 0;
    }, { timeout: 8000 }).toBe(1);
    await pagina.waitForTimeout(500);
    await lasciaNelRiquadro(app, shell, pagina, frame, sorgente);
    await expect.poll(() => frame.locator('#t').inputValue(), { timeout: 5000 }).toContain(sorgenteUrl);
    const valore = await frame.locator('#t').inputValue();
    expect(valore).toContain('Ricetta del pane');
    expect(valore.startsWith('Commento:')).toBe(true);
  });
}
