// Esplorazione del giro 4 (#1433): si cancella prima della consegna.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const EDITOR = 'filo://editor/editor.html';
const aperto = (ed) => ed.evaluate(() => document.documentElement.classList.contains('pd-aperto'));
async function apriEditor(openTab) {
  const ed = await openTab(EDITOR);
  await ed.waitForSelector('#doc');
  await ed.waitForFunction(() => document.querySelector('.pd-pannello') && document.querySelector('.pd-elemento[data-elemento="word-count"]'));
  return ed;
}
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
const esegui = (app, a) => app.evaluate((_e, x) => globalThis.SN_EXECUTE_FILO_ACTION(x), a);

test('A controllo: aperto col tasto, Grassetto del pannello sulla selezione', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: 'bold' });
  await ed.waitForSelector('.pd-elemento[data-elemento="bold"]', { state: 'attached' });
  await ed.click('#doc');
  await ed.keyboard.type('alfa beta gamma');
  await ed.keyboard.press('Control+A');
  await premi(app, '\\', ['control']);
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(300);
  await ed.locator('.pd-elemento[data-elemento="bold"] .pd-contenuto button').first().click();
  await expect(ed.locator('#doc b, #doc strong')).toHaveText('alfa beta gamma', { timeout: 3000 });
});

test('B aperto col tasto, clic sul vuoto della testa del pannello, poi Grassetto', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: 'bold' });
  await ed.waitForSelector('.pd-elemento[data-elemento="bold"]', { state: 'attached' });
  await ed.click('#doc');
  await ed.keyboard.type('alfa beta gamma');
  await ed.keyboard.press('Control+A');
  await premi(app, '\\', ['control']);
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(300);
  const t = await ed.locator('.pd-testa').boundingBox();
  await ed.mouse.click(t.x + 10, t.y + t.height / 2);
  await ed.locator('.pd-elemento[data-elemento="bold"] .pd-contenuto button').first().click();
  await expect(ed.locator('#doc b, #doc strong')).toHaveText('alfa beta gamma', { timeout: 3000 });
});

test('C striscia col mouse vero, poi Allineamento a destra sulla selezione', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: 'align' });
  await ed.waitForSelector('.pd-elemento[data-elemento="align"]', { state: 'attached' });
  await ed.click('#doc');
  await ed.keyboard.type('primo paragrafo');
  await ed.keyboard.press('Enter');
  await ed.keyboard.type('secondo paragrafo');
  await ed.keyboard.press('Control+A');
  const s = await ed.locator('.pd-striscia').boundingBox();
  await ed.mouse.click(s.x + s.width / 2, 400);
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(300);
  const html = await ed.locator('.pd-elemento[data-elemento="align"] .pd-contenuto').innerHTML();
  console.log('ALIGN', html.slice(0, 400));
  const bottoni = ed.locator('.pd-elemento[data-elemento="align"] .pd-contenuto button');
  console.log('n bottoni', await bottoni.count());
  await bottoni.nth(2).click();
  const sel = await ed.evaluate(() => [...document.querySelectorAll('#doc > *')].map((n) => n.style.textAlign || getComputedStyle(n).textAlign));
  console.log('ALLINEAMENTI', sel);
});

test('D tutti gli strumenti in finestra bassa: l\'ultimo si raggiunge', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  for (const el of ['text-size', 'align', 'font', 'undo', 'redo', 'settings', 'bold', 'italic', 'underline']) {
    await esegui(app, { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: el });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).setBounds({ x: 0, y: 0, width: 1100, height: 520 }));
  await premi(app, '\\', ['control']);
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(400);
  mkdirSync('tests/.shots', { recursive: true });
  await ed.screenshot({ path: 'tests/.shots/g4-tutti-basso.png' });
  await ed.locator('.pd-elemento[data-elemento="underline"]').scrollIntoViewIfNeeded();
  const b = await ed.locator('.pd-elemento[data-elemento="underline"]').boundingBox();
  const h = await ed.evaluate(() => window.innerHeight);
  console.log('underline', b, 'h', h);
  await ed.click('.pd-piu');
  await ed.waitForTimeout(300);
  await ed.screenshot({ path: 'tests/.shots/g4-tutti-basso-espanso.png' });
  expect(b.y + b.height).toBeLessThanOrEqual(h);
});

test('E tutti tolti: pannello vuoto, il + rimette', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  for (const el of ['word-count', 'search-replace', 'comment']) await esegui(app, { type: 'PANNELLO_APP', operazione: 'togli', elemento: el });
  await premi(app, '\\', ['control']);
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(400);
  await ed.screenshot({ path: 'tests/.shots/g4-vuoto.png' });
  await ed.click('.pd-piu');
  await ed.waitForTimeout(300);
  await ed.screenshot({ path: 'tests/.shots/g4-vuoto-espanso.png' });
  await ed.click('.pd-catalogo .pd-voce[data-elemento="comment"]');
  await expect(ed.locator('.pd-elementi .pd-elemento[data-elemento="comment"]')).toHaveCount(1);
});

test('F tema scuro: pannello aperto ed espanso', async ({ app, openTab }) => {
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  const ed = await apriEditor(openTab);
  await ed.click('#doc');
  await ed.keyboard.type('Testo di prova nel tema scuro.');
  await premi(app, '\\', ['control']);
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(400);
  await ed.screenshot({ path: 'tests/.shots/g4-scuro.png' });
  await ed.click('.pd-piu');
  await ed.waitForTimeout(300);
  await ed.screenshot({ path: 'tests/.shots/g4-scuro-espanso.png' });
});

test('G Aiuto ridotto alla casella, bloccato: quanto si stringe il foglio', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1');
  await ed.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = Array.from({ length: 8 }, () => '<p>Una riga di testo abbastanza lunga da arrivare fino al bordo destro della colonna centrale del foglio.</p>').join('');
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'blocca' });
  await expect.poll(() => ed.evaluate(() => document.documentElement.classList.contains('pd-bloccato'))).toBe(true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.barra.esegui('help'));
  await expect(ed.locator('.sn-sidebar')).toBeVisible();
  await ed.waitForTimeout(500);
  await ed.screenshot({ path: 'tests/.shots/g4-aiuto-aperto-bloccato.png' });
  await ed.mouse.click(120, 300);
  await ed.waitForTimeout(800);
  const m = await ed.evaluate(() => ({
    cls: document.querySelector('.sn-sidebar').className,
    aiuto: JSON.parse(JSON.stringify(document.querySelector('.sn-sidebar').getBoundingClientRect())),
    pannello: JSON.parse(JSON.stringify(document.querySelector('.pd-pannello').getBoundingClientRect())),
    doc: JSON.parse(JSON.stringify(document.getElementById('doc').getBoundingClientRect())),
    w: window.innerWidth,
  }));
  console.log('RIDOTTO', JSON.stringify(m));
  await ed.screenshot({ path: 'tests/.shots/g4-aiuto-ridotto-bloccato.png' });
});
