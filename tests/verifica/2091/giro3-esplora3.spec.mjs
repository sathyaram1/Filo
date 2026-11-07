// Esplorazione 3 del giro 3: Annulla dopo un rilascio in un campo di una pagina. Si cancella.

import { test, expect } from '../../fixtures/electron.mjs';
import { disponibili, finestraASchermo, trascina } from '../../helpers/gestiVeri.mjs';

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);
const idPerUrl = async (shell, url) => (await schede(shell)).find((t) => t.url === url)?.id;

async function linguetta(app, shell, id) {
  const r = await shell.locator(`.tab[data-id="${id}"]`).boundingBox();
  const o = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const cb = w.getContentBounds();
    return { x: cb.x, y: cb.y, z: w.webContents.getZoomFactor() || 1 };
  });
  return { x: Math.round(o.x + (r.x + r.width / 2) * o.z), y: Math.round(o.y + (r.y + r.height / 2) * o.z) };
}
async function sulloSchermo(app, doc, sel) {
  const r = await doc.locator(sel).first().boundingBox();
  const o = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const cb = w.getContentBounds();
    const tm = w._filoTabs;
    const vb = tm.tabs.find((x) => x.id === tm.activeId).view.getBounds();
    return { x: cb.x + vb.x, y: cb.y + vb.y };
  });
  return { x: Math.round(o.x + r.x + Math.min(30, r.width / 2)), y: Math.round(o.y + r.y + r.height / 2) };
}

test.describe.configure({ retries: 0 });
test.beforeEach(() => { test.skip(!disponibili(), 'niente XTest'); });

test('O Annulla dopo il rilascio in una textarea e in un contenteditable', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const url = testServer.html('<title>Ricetta del pane</title><p>x');
  await openTab(url);
  const id = await idPerUrl(shell, url);
  const pagina = await openTab(testServer.html('<title>Moduli</title><textarea id="t" style="width:300px;height:60px">Ciao</textarea><div id="c" contenteditable="true" style="width:300px;height:60px;border:1px solid">scritto</div>'));
  await finestraASchermo(app);
  await pagina.waitForTimeout(800);
  for (const sel of ['#t', '#c']) {
    trascina(await linguetta(app, shell, id), await sulloSchermo(app, pagina, sel));
    await pagina.waitForTimeout(800);
    const prima = await pagina.evaluate((s) => { const e = document.querySelector(s); return { v: e.value ?? e.innerText, f: document.activeElement === e }; }, sel);
    await pagina.keyboard.press('Control+z');
    await pagina.waitForTimeout(300);
    const dopo = await pagina.evaluate((s) => { const e = document.querySelector(s); return e.value ?? e.innerText; }, sel);
    console.log('O', sel, JSON.stringify(prima), '-> annulla ->', JSON.stringify(dopo));
  }
});
