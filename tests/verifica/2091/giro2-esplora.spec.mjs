// Verifica #2091 giro 2: esplorazione (si cancella prima del verdetto).

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina } from '../../helpers/chatFinta.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs);
const ordine = async (shell) => (await schede(shell)).map((t) => t.id);
const idPerUrl = async (shell, url) => (await schede(shell)).find((t) => t.url === url)?.id;
async function linguetta(shell, id) {
  return shell.evaluate((i) => {
    const r = document.querySelector(`.tab[data-id="${i}"]`).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right };
  }, id);
}
async function puntoInPagina(app, page, selettore, frame = null) {
  const loc = (frame || page).locator(selettore).first();
  const r = await loc.evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + Math.min(24, b.width / 2), y: b.top + b.height / 2 };
  });
  let off = { x: 0, y: 0 };
  if (frame) off = await page.locator('iframe').first().evaluate((f) => { const b = f.getBoundingClientRect(); return { x: b.left + f.clientLeft, y: b.top + f.clientTop }; });
  const v = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return { b: t.view.getBounds(), z: t.view.webContents.getZoomFactor() || 1, zs: w.webContents.getZoomFactor() || 1 };
  });
  return { x: (v.b.x + (r.x + off.x) * v.z) / v.zs, y: (v.b.y + (r.y + off.y) * v.z) / v.zs };
}
async function puntoNelloStrato(app, aiuto, selettore) {
  const r = await aiuto.locator(selettore).first().evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + Math.min(24, b.width / 2), y: b.top + b.height / 2 };
  });
  const v = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    const s = tm.riquadri.strati.get(t.view.webContents);
    return { b: s.perIlVuoto.getBounds(), z: s.vista.webContents.getZoomFactor() || 1, zs: w.webContents.getZoomFactor() || 1 };
  });
  return { x: (v.b.x + r.x * v.z) / v.zs, y: (v.b.y + r.y * v.z) / v.zs };
}
async function trascina(shell, da, verso) {
  await shell.mouse.move(da.x, da.y);
  await shell.mouse.down();
  await shell.mouse.move(da.x + 8, da.y, { steps: 2 });
  await shell.mouse.move(verso.x, verso.y, { steps: 8 });
  await shell.mouse.up();
}

test('E1 Esc a metà trascinamento', async ({ shell, openTab, testServer }) => {
  await openTab(testServer.html('<title>Uno</title><p>uno'));
  await openTab(testServer.html('<title>Due</title><p>due'));
  await openTab(testServer.html('<title>Tre</title><p>tre'));
  const prima = await ordine(shell);
  const da = await linguetta(shell, prima[1]);
  const ultima = await linguetta(shell, prima.at(-1));
  await shell.mouse.move(da.x, da.y);
  await shell.mouse.down();
  await shell.mouse.move(da.x + 8, da.y, { steps: 2 });
  await shell.mouse.move(ultima.right - 4, da.y, { steps: 8 });
  await shell.keyboard.press('Escape');
  const dopoEsc = await shell.evaluate((i) => ({ cls: document.querySelector(`.tab[data-id="${i}"]`).className, t: getComputedStyle(document.querySelector(`.tab[data-id="${i}"]`)).transform }), prima[1]);
  await shell.mouse.up();
  await shell.waitForTimeout(500);
  console.log('E1', JSON.stringify({ dopoEsc, prima, dopo: await ordine(shell) }));
});

test('E2 Aiuto sopra un sito con gettone, poi la riga dell\'Aiuto nella home', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const url = testServer.html('<title>Articolo sulla Tesla</title><p>La Tesla Roadster è volata su un Falcon Heavy.</p>');
  await openTab(url);
  const sorgente = await idPerUrl(shell, url);
  const sito = await openTab(testServer.html('<title>Un sito</title><p>un sito qualunque'));
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, sito);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8000 });
  const verso = await puntoNelloStrato(app, aiuto, '.sn-sidebar-input textarea');
  await trascina(shell, await linguetta(shell, sorgente), verso);
  await expect(aiuto.locator('.sn-gettoni-fondo .sn-gettone')).toHaveCount(1, { timeout: 5000 });
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models: { [C.ACTIONS.HELP]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry });
    const P = globalThis.SN_PROVIDERS;
    const risposta = ({ attempts }) => ({ text: '{"message":"Con un razzo.","suggestions":[],"issues":[]}', model: attempts[0].model, provider: attempts[0].provider, usage: {} });
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => risposta(o);
  });
  await aiuto.locator('.sn-sidebar-input textarea').focus();
  await aiuto.keyboard.press('End');
  await aiuto.keyboard.type('come ha fatto?');
  await aiuto.keyboard.press('Enter');
  await expect(aiuto.locator('.sn-sidebar-msg-user .sn-bolla-gettone')).toHaveCount(1, { timeout: 15_000 });
  await aiuto.waitForTimeout(4000);
  console.log('E2 aiuto', JSON.stringify(await aiuto.evaluate(() => [...document.querySelectorAll('*')].filter((e) => e.shadowRoot).length)));
  const chats = await app.evaluate(async () => {
    const A = globalThis.SN_CHAT_ARCHIVE || globalThis.SN_CHATS;
    return Object.keys(globalThis).filter((k) => /CHAT|ARCHIV/i.test(k));
  });
  console.log('E2 moduli', JSON.stringify(chats));
  const nuova = await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab'));
  const casa = await home(app, { scheda: nuova?.id });
  await casa.waitForTimeout(1500);
  const righe = await casa.evaluate(() => [...document.querySelectorAll('.dash-riga-app')].map((r) => r.innerText));
  console.log('E2 righe', JSON.stringify(righe));
  const r = casa.locator('.dash-riga-app-testa').first();
  if (await r.count()) {
    await r.click();
    await casa.waitForTimeout(1000);
    console.log('E2 corpo', JSON.stringify(await casa.evaluate(() => [...document.querySelectorAll('.dash-riga-app-corpo')].map((c) => c.innerText))));
  }
  await casa.screenshot({ path: 'tests/.shots/v2091-e2-home.png' });
});

test('E3 campo di un riquadro di un altro sito, e pagina zoomata', async ({ app, shell, openTab, testServer }) => {
  const sorgenteUrl = testServer.html('<title>Ricetta del pane</title><p>farina');
  await openTab(sorgenteUrl);
  const sorgente = await idPerUrl(shell, sorgenteUrl);
  const dentro = testServer.html('<title>commenti</title><textarea id="t" style="width:300px;height:80px">Commento:</textarea>', { pubblico: true });
  const pagina = await openTab(testServer.html(`<title>Blog</title><p>articolo</p><iframe src="${dentro}" style="margin:40px;width:400px;height:150px"></iframe>`));
  await pagina.waitForTimeout(1500);
  const fr = pagina.frames().find((f) => f.url() === dentro);
  const verso = await puntoInPagina(app, pagina, '#t', fr);
  await trascina(shell, await linguetta(shell, sorgente), verso);
  await pagina.waitForTimeout(1500);
  console.log('E3 riquadro', JSON.stringify(await fr.locator('#t').inputValue()));

  const zoomata = await openTab(testServer.html('<title>Modulo</title><textarea id="t" style="margin:120px 0 0 300px;width:200px;height:60px">Z:</textarea>'));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x.isDestroyed() && !x._filoIncognito);
    const tm = w._filoTabs; tm.tabs.find((x) => x.id === tm.activeId).view.webContents.setZoomFactor(1.5);
  });
  await zoomata.waitForTimeout(500);
  const v2 = await puntoInPagina(app, zoomata, '#t');
  await trascina(shell, await linguetta(shell, sorgente), v2);
  await zoomata.waitForTimeout(1000);
  console.log('E3 zoom', JSON.stringify(await zoomata.locator('#t').inputValue()));
});

test('E4 Aiuto sopra l\'Editor', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const url = testServer.html('<title>Articolo sulla Tesla</title><p>Falcon Heavy</p>');
  await openTab(url);
  const sorgente = await idPerUrl(shell, url);
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForTimeout(1500);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await ed.waitForTimeout(1500);
  let aiuto = null;
  try { aiuto = await paginaDellAiuto(app, ed); } catch (e) { console.log('E4 niente strato', String(e).slice(0, 200)); }
  const dove = aiuto || ed;
  const n = await dove.locator('.sn-sidebar-input textarea').count();
  console.log('E4 campi', n, aiuto ? 'strato' : 'pagina');
  if (!n) return;
  const verso = aiuto && aiuto !== ed ? await puntoNelloStrato(app, aiuto, '.sn-sidebar-input textarea') : await puntoInPagina(app, ed, '.sn-sidebar-input textarea');
  await trascina(shell, await linguetta(shell, sorgente), verso);
  await dove.waitForTimeout(1500);
  console.log('E4 gettoni', await dove.locator('.sn-gettoni-fondo .sn-gettone').count(), JSON.stringify(await dove.locator('.sn-sidebar-input textarea').inputValue()));
  await ed.screenshot({ path: 'tests/.shots/v2091-e4-editor.png' });
});

test('E5 tema scuro: gettone nel campo e nel filo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  const url = testServer.html('<title>Un titolo molto lungo di un articolo sulla Tesla volante 🚀 &lt;b&gt;x&lt;/b&gt;</title><p>Falcon Heavy</p>');
  await openTab(url);
  const sorgente = await idPerUrl(shell, url);
  const casa = (await schede(shell)).find((t) => String(t.url).startsWith('filo://newtab'));
  await shell.evaluate((i) => window.filoShell.tabs.activate(i), casa.id);
  const page = await home(app);
  await page.locator('#input').fill('confronta');
  for (let i = 0; i < 2; i++) {
    const verso = await puntoInPagina(app, page, '#input');
    await trascina(shell, await linguetta(shell, sorgente), verso);
    await page.waitForTimeout(500);
  }
  await page.locator('#input').focus();
  await page.keyboard.press('End');
  await page.keyboard.type(' e dimmi quale preferisci tra i due articoli che ti ho mandato oggi pomeriggio');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/v2091-e5-campo.png' });
  await modelloFinto(app, [{ text: 'Ecco.' }]);
  try {
    await page.locator('#sendBtn').click();
    await expect(page.getByText('Ecco.')).toBeVisible({ timeout: 15_000 });
  } finally { await ripristina(app); }
  await page.screenshot({ path: 'tests/.shots/v2091-e5-filo.png' });
  console.log('E5 bolla', JSON.stringify(await page.locator('.dash-bubble-user').last().innerText()));
});
