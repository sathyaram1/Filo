// Verifica #2091 giro 2: esplorazione (si cancella prima del verdetto).

import fs from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);
const idPerUrl = async (shell, url) => (await schede(shell)).find((t) => t.url === url)?.id;
async function linguetta(shell, id) {
  return shell.evaluate((i) => {
    const r = document.querySelector(`.tab[data-id="${i}"]`).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right };
  }, id);
}
async function puntoInPagina(app, page, selettore) {
  const r = await page.locator(selettore).first().evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + Math.min(24, b.width / 2), y: b.top + b.height / 2 };
  });
  const v = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return { b: t.view.getBounds(), z: t.view.webContents.getZoomFactor() || 1, zs: w.webContents.getZoomFactor() || 1 };
  });
  return { x: (v.b.x + r.x * v.z) / v.zs, y: (v.b.y + r.y * v.z) / v.zs };
}
const foto = async (app, nome) => {
  const b64 = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
    return (await w.capturePage()).toPNG().toString('base64');
  });
  fs.mkdirSync('tests/.shots', { recursive: true });
  fs.writeFileSync(`tests/.shots/v2091-${nome}.png`, Buffer.from(b64, 'base64'));
};

test('F1 due schede con lo stesso inizio di titolo: tolta la prima resta la seconda', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const a = testServer.html('<title>Amazon.it: Apple iPhone 15 (128 GB) - Nero</title><p>prodotto A');
  const b = testServer.html('<title>Amazon.it: Apple iPhone 15 Pro (256 GB) - Titanio</title><p>prodotto B');
  await openTab(a);
  await openTab(b);
  const ia = await idPerUrl(shell, a);
  const ib = await idPerUrl(shell, b);
  const casa = (await schede(shell)).find((t) => String(t.url).startsWith('filo://newtab'));
  await shell.evaluate((i) => window.filoShell.tabs.activate(i), casa.id);
  const page = await home(app);
  await page.locator('#input').fill('confronta');
  for (const id of [ia, ib]) {
    const verso = await puntoInPagina(app, page, '#input');
    const da = await linguetta(shell, id);
    await shell.mouse.move(da.x, da.y);
    await shell.mouse.down();
    await shell.mouse.move(da.x + 8, da.y, { steps: 2 });
    await shell.mouse.move(verso.x, verso.y, { steps: 8 });
    if (id === ib) await foto(app, 'f1-sopra-home');
    await shell.mouse.up();
    await page.waitForTimeout(400);
  }
  const prima = await page.evaluate(() => ({ v: document.getElementById('input').value, s: document.getElementById('input')._snGettoni.schede().map((x) => x.url) }));
  // Toglie il primo gettone: cursore subito dopo, Backspace.
  await page.evaluate(() => { const t = document.getElementById('input'); const i = t.value.indexOf('⟧') + 1; t.focus(); t.setSelectionRange(i, i); });
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  const dopo = await page.evaluate(() => ({ v: document.getElementById('input').value, s: document.getElementById('input')._snGettoni.schede().map((x) => x.url) }));
  console.log('F1', JSON.stringify({ a, b, prima, dopo }));
});

test('F2 cosa si vede sopra la pagina mentre si trascina', async ({ app, shell, openTab, testServer }) => {
  const src = testServer.html('<title>Ricetta del pane</title><p>farina');
  await openTab(src);
  const campo = await openTab(testServer.html('<title>Modulo</title><p style="margin:40px">pagina</p><textarea id="t" style="margin:40px;width:400px;height:120px"></textarea>'));
  const id = await idPerUrl(shell, src);
  const da = await linguetta(shell, id);
  await shell.mouse.move(da.x, da.y);
  await shell.mouse.down();
  await shell.mouse.move(da.x + 8, da.y, { steps: 2 });
  await shell.mouse.move(da.x + 60, da.y + 200, { steps: 8 });
  await foto(app, 'f2-sopra-pagina');
  const verso = await puntoInPagina(app, campo, '#t');
  await shell.mouse.move(verso.x, verso.y, { steps: 8 });
  await foto(app, 'f2-sopra-campo');
  await shell.mouse.up();
});
