// Esplorazione del verificatore, giro 3: si cancella prima della critica.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const EDITOR = 'filo://editor/editor.html';
const SHOTS = 'tests/.shots/v1433';
const aperto = (ed) => ed.evaluate(() => document.documentElement.classList.contains('pd-aperto'));
const elementi = (ed) => ed.evaluate(() => [...document.querySelectorAll('.pd-elementi > .pd-elemento')].map((n) => n.dataset.elemento));
mkdirSync(SHOTS, { recursive: true });

async function premi(app, key, modifiers = []) {
  await app.evaluate(({ BrowserWindow }, { key, modifiers }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const t = win._filoTabs.tabs.find((x) => x.id === win._filoTabs.activeId);
    const wc = t.view.webContents;
    wc.focus();
    wc.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers });
  }, { key, modifiers });
}

async function apri(openTab) {
  const ed = await openTab(EDITOR);
  await ed.waitForSelector('#doc');
  await ed.waitForFunction(() => document.querySelector('.pd-elemento[data-elemento="word-count"]'));
  return ed;
}

test('tema scuro: tutti gli strumenti nel pannello, espanso, bloccato', async ({ app, openTab }) => {
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  const ed = await apri(openTab);
  await ed.click('#doc');
  await ed.keyboard.type('Una riga di prova per vedere il foglio scuro con il pannello degli strumenti aperto.');
  for (const id of ['text-size', 'align', 'font', 'undo', 'redo', 'settings', 'bold', 'italic', 'underline']) {
    await app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: id });
  }
  await premi(app, '\\', ['control']);
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(500);
  console.log('ELEMENTI', JSON.stringify(await elementi(ed)));
  await ed.screenshot({ path: `${SHOTS}/scuro-tutti.png` });
  await ed.click('.pd-piu');
  await ed.waitForTimeout(300);
  await ed.screenshot({ path: `${SHOTS}/scuro-espanso-pieno.png` });
  await ed.click('.pd-piu');
  await ed.click('.pd-lucchetto');
  await ed.waitForTimeout(400);
  await ed.screenshot({ path: `${SHOTS}/scuro-bloccato.png` });
  // dimensione testo, allineamento, corsivo, sottolineato, indietro
  await ed.click('#doc');
  await ed.keyboard.press('Control+A');
  const sz0 = await ed.evaluate(() => getComputedStyle(document.querySelector('#doc p, #doc div, #doc') ).fontSize);
  const btns = await ed.evaluate(() => [...document.querySelectorAll('.pd-elemento button')].map((b) => `${b.closest('.pd-elemento').dataset.elemento}:${b.title}`));
  console.log('BOTTONI', JSON.stringify(btns));
  await ed.locator('.pd-elemento[data-elemento="text-size"] button').last().dispatchEvent('mousedown', { button: 0 });
  await ed.locator('.pd-elemento[data-elemento="text-size"] button').last().click().catch(() => {});
  await ed.waitForTimeout(200);
  console.log('HTML dopo A+', await ed.evaluate(() => document.getElementById('doc').innerHTML.slice(0, 300)));
  await ed.keyboard.press('Control+A');
  await ed.locator('.pd-elemento[data-elemento="align"] button').nth(1).click().catch((e) => console.log('align err', e.message));
  await ed.waitForTimeout(200);
  console.log('HTML dopo centra', await ed.evaluate(() => document.getElementById('doc').innerHTML.slice(0, 300)));
  await ed.locator('.pd-elemento[data-elemento="undo"] button').first().click().catch((e) => console.log('undo err', e.message));
  await ed.waitForTimeout(200);
  console.log('HTML dopo indietro', await ed.evaluate(() => document.getElementById('doc').innerHTML.slice(0, 300)));
  await ed.locator('.pd-elemento[data-elemento="font"]').locator('button, select, input').first().click().catch((e) => console.log('font err', e.message));
  await ed.waitForTimeout(400);
  await ed.screenshot({ path: `${SHOTS}/scuro-font.png` });
  await ed.keyboard.press('Escape');
  await ed.locator('.pd-elemento[data-elemento="settings"] button').click();
  await ed.waitForTimeout(300);
  await ed.screenshot({ path: `${SHOTS}/scuro-impostazioni.png` });
});

test('scorciatoie di formattazione di partenza: Ctrl+B, Ctrl+I, Ctrl+U senza gli strumenti nel pannello', async ({ app, openTab }) => {
  const ed = await apri(openTab);
  await ed.click('#doc');
  await ed.keyboard.type('forte');
  await ed.keyboard.press('Control+A');
  await premi(app, 'B', ['control']);
  await ed.waitForTimeout(200);
  console.log('B', await ed.evaluate(() => document.getElementById('doc').innerHTML));
  await premi(app, 'I', ['control']);
  await ed.waitForTimeout(200);
  console.log('I', await ed.evaluate(() => document.getElementById('doc').innerHTML));
  await premi(app, 'U', ['control']);
  await ed.waitForTimeout(200);
  console.log('U', await ed.evaluate(() => document.getElementById('doc').innerHTML));
});

test('finestra stretta, bloccato e Aiuto aperto', async ({ app, openTab }) => {
  const ed = await apri(openTab);
  await ed.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1');
  await ed.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = Array.from({ length: 8 }, () => '<p>Una riga di testo abbastanza lunga da arrivare fino al bordo destro della colonna.</p>').join('');
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).setBounds({ x: 0, y: 0, width: 820, height: 700 }));
  await ed.waitForTimeout(500);
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await ed.click('.pd-lucchetto');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.barra.esegui('help'));
  await expect(ed.locator('.sn-sidebar')).toBeVisible();
  await ed.waitForTimeout(600);
  const m = await ed.evaluate(() => ({
    vw: innerWidth,
    doc: document.getElementById('doc').getBoundingClientRect().toJSON(),
    pan: document.querySelector('.pd-pannello').getBoundingClientRect().toJSON(),
    aiuto: document.querySelector('.sn-sidebar').getBoundingClientRect().toJSON(),
  }));
  console.log('STRETTA', JSON.stringify(m));
  await ed.screenshot({ path: `${SHOTS}/stretta-bloccato-aiuto.png` });
  // Aiuto ridotto con un clic fuori
  await ed.mouse.click(100, 400);
  await ed.waitForTimeout(600);
  const m2 = await ed.evaluate(() => ({
    pan: document.querySelector('.pd-pannello').getBoundingClientRect().toJSON(),
    aiuto: document.querySelector('.sn-sidebar').getBoundingClientRect().toJSON(),
    cls: document.querySelector('.sn-sidebar').className,
    doc: document.getElementById('doc').getBoundingClientRect().toJSON(),
  }));
  console.log('RIDOTTO', JSON.stringify(m2));
  await ed.screenshot({ path: `${SHOTS}/stretta-aiuto-ridotto.png` });
});

test('Aiuto ridotto e pannello sbloccato', async ({ app, openTab }) => {
  const ed = await apri(openTab);
  await ed.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.barra.esegui('help'));
  await expect(ed.locator('.sn-sidebar')).toBeVisible();
  await ed.mouse.click(200, 300);
  await ed.waitForTimeout(600);
  await premi(app, '\\', ['control']);
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(500);
  const m = await ed.evaluate(() => ({
    pan: document.querySelector('.pd-pannello').getBoundingClientRect().toJSON(),
    aiuto: document.querySelector('.sn-sidebar').getBoundingClientRect().toJSON(),
    cls: document.querySelector('.sn-sidebar').className,
  }));
  console.log('RIDOTTO-SBLOCCATO', JSON.stringify(m));
  await ed.screenshot({ path: `${SHOTS}/aiuto-ridotto-pannello.png` });
});

test('altre pagine filo:// e web: Ctrl+\\ e pannello', async ({ app, openTab }) => {
  const dash = await openTab('filo://history/history.html');
  await dash.waitForLoadState('domcontentloaded');
  await dash.waitForTimeout(800);
  await premi(app, '\\', ['control']);
  await dash.waitForTimeout(400);
  console.log('HISTORY', await dash.evaluate(() => ({ pd: !!document.querySelector('.pd-pannello'), cls: document.documentElement.className })));
  const st = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w._filoTabs.tabs.map((t) => ({ url: t.url, p: t.pannelloApp || null }));
  });
  console.log('TABS', JSON.stringify(st));
});

test('preferenze: sezione del pannello', async ({ openTab }) => {
  const p = await openTab('filo://preferences/preferences.html#sec-pannello');
  await p.waitForSelector('#sec-pannello', { state: 'attached' });
  await p.waitForTimeout(800);
  console.log('PREF', await p.evaluate(() => document.getElementById('sec-pannello').innerText));
  await p.evaluate(() => document.getElementById('sec-pannello').scrollIntoView());
  await p.screenshot({ path: `${SHOTS}/pref-pannello.png` });
});

test('cerca e sostituisci: sostituisci tutto', async ({ app, openTab }) => {
  const ed = await apri(openTab);
  await ed.click('#doc');
  await ed.keyboard.type('il gatto e il cane e il topo');
  await premi(app, 'F', ['control']);
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.keyboard.type('il');
  await ed.waitForTimeout(300);
  await ed.screenshot({ path: `${SHOTS}/cerca.png` });
  console.log('SR', await ed.evaluate(() => document.querySelector('.pd-elemento[data-elemento="search-replace"]').innerHTML.slice(0, 1500)));
});
