// Esplorazione del giro 7: si cancella prima della critica.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const EDITOR = 'filo://editor/editor.html';
const SHOTS = 'tests/.shots/v1433';
mkdirSync(SHOTS, { recursive: true });

async function apriEditor(openTab) {
  const ed = await openTab(EDITOR);
  await ed.waitForSelector('#doc');
  await ed.waitForFunction(() => document.querySelector('.pd-pannello') && document.querySelector('.pd-elemento[data-elemento="word-count"]'));
  return ed;
}
const aperto = (ed) => ed.evaluate(() => document.documentElement.classList.contains('pd-aperto'));
const elementi = (ed) => ed.evaluate(() => [...document.querySelectorAll('.pd-elementi > .pd-elemento')].map((n) => n.dataset.elemento));
const win = (app, fn) => app.evaluate(fn);
const esegui = (app, a) => app.evaluate((_e, x) => globalThis.SN_EXECUTE_FILO_ACTION(x), a);

test('e1 tema scuro: pannello aperto, espanso, bloccato', async ({ app, openTab }) => {
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  const ed = await apriEditor(openTab);
  await ed.click('#doc');
  await ed.keyboard.type('Una riga di testo nel tema scuro per vedere il pannello.');
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(500);
  await ed.screenshot({ path: `${SHOTS}/scuro-aperto.png` });
  await ed.click('.pd-piu');
  await ed.waitForTimeout(400);
  await ed.screenshot({ path: `${SHOTS}/scuro-espanso.png` });
  await ed.click('.pd-piu');
  await ed.click('.pd-lucchetto');
  await ed.waitForTimeout(500);
  await ed.screenshot({ path: `${SHOTS}/scuro-bloccato.png` });
  // hover sulla striscia, sul +, sul lucchetto
  const tit = await ed.evaluate(() => ({ s: document.querySelector('.pd-striscia').title, p: document.querySelector('.pd-piu').title, l: document.querySelector('.pd-lucchetto').title }));
  console.log('TITOLI', JSON.stringify(tit));
});

test('e2 tasto destro: togli e aggiungi', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(400);
  await ed.locator('.pd-elemento[data-elemento="comment"]').click({ button: 'right' });
  await ed.waitForTimeout(300);
  const voci = await ed.evaluate(() => [...document.querySelectorAll('.pd-menu *')].filter((n) => !n.children.length).map((n) => n.textContent.trim()).filter(Boolean));
  console.log('VOCI ELEMENTO', JSON.stringify(voci));
  await ed.screenshot({ path: `${SHOTS}/menu-elemento.png` });
  const togli = ed.getByText('Togli dal pannello');
  await togli.click();
  await expect.poll(() => elementi(ed)).toEqual(['word-count', 'search-replace']);
  console.log('APERTO DOPO TOGLI', await aperto(ed));
  await ed.click('.pd-piu');
  await ed.waitForTimeout(300);
  const cat = await ed.evaluate(() => [...document.querySelectorAll('.pd-catalogo > *')].map((n) => n.textContent.trim()));
  console.log('CATALOGO', JSON.stringify(cat));
  const v = ed.locator('.pd-catalogo > *', { hasText: 'Corsivo' }).first();
  await v.click({ button: 'right' });
  await ed.waitForTimeout(300);
  const voci2 = await ed.evaluate(() => [...document.querySelectorAll('.pd-menu *')].filter((n) => !n.children.length).map((n) => n.textContent.trim()).filter(Boolean));
  console.log('VOCI CATALOGO', JSON.stringify(voci2));
  await ed.screenshot({ path: `${SHOTS}/menu-catalogo.png` });
});

test('e3 due schede editor: aggiunta e lucchetto si vedono nell altra', async ({ app, openTab }) => {
  const a = await apriEditor(openTab);
  const b = await apriEditor(openTab);
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: 'corsivo' });
  await b.waitForTimeout(500);
  console.log('A', JSON.stringify(await elementi(a)), 'B', JSON.stringify(await elementi(b)));
  await b.evaluate(() => document.querySelector('.pd-striscia').click());
  await b.click('.pd-lucchetto');
  await b.waitForTimeout(600);
  console.log('A bloccato', await a.evaluate(() => document.documentElement.classList.contains('pd-bloccato')), 'aperto', await aperto(a));
});

test('e4 Aiuto ridotto alla casella e pannello aperto', async ({ app, openTab }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito).setContentSize(1400, 860));
  const ed = await apriEditor(openTab);
  await ed.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1' && typeof window.SN_SIDEBAR?.open === 'function');
  await ed.click('#doc');
  await ed.keyboard.type('Testo del documento abbastanza lungo da occupare tutta la colonna di testo del foglio, e andare a capo almeno una volta per vedere.');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.barra.esegui('help'));
  await expect(ed.locator('.sn-sidebar')).toBeVisible();
  await ed.waitForTimeout(600);
  await ed.mouse.click(300, 300);
  await ed.waitForTimeout(800);
  const st = await ed.evaluate(() => ({ cls: document.querySelector('.sn-sidebar').className, r: JSON.stringify(document.querySelector('.sn-sidebar').getBoundingClientRect()) }));
  console.log('AIUTO DOPO CLIC FUORI', JSON.stringify(st));
  await ed.screenshot({ path: `${SHOTS}/aiuto-dopo-clic.png` });
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await ed.waitForTimeout(600);
  const m = await ed.evaluate(() => ({ p: JSON.stringify(document.querySelector('.pd-pannello').getBoundingClientRect()), a: JSON.stringify(document.querySelector('.sn-sidebar').getBoundingClientRect()), s: JSON.stringify(document.querySelector('.pd-striscia').getBoundingClientRect()) }));
  console.log('PANNELLO CON AIUTO', JSON.stringify(m));
  await ed.screenshot({ path: `${SHOTS}/aiuto-ridotto-pannello.png` });
  // chiudi l'Aiuto: il pannello resta coerente?
  await ed.locator('.sn-sidebar-close').click().catch(() => console.log('NO CLOSE'));
  await ed.waitForTimeout(600);
  const m2 = await ed.evaluate(() => ({ p: JSON.stringify(document.querySelector('.pd-pannello').getBoundingClientRect()), ap: document.documentElement.className }));
  console.log('DOPO CHIUSURA AIUTO', JSON.stringify(m2));
  await ed.screenshot({ path: `${SHOTS}/dopo-chiusura-aiuto.png` });
});

test('e5 pagina web: niente striscia', async ({ openTab, testServer }) => {
  const p = await testServer.openReady(openTab, '<html><body><p>ciao</p></body></html>');
  await p.waitForTimeout(500);
  console.log('WEB STRISCIA', await p.evaluate(() => !!document.querySelector('.pd-striscia, .pd-pannello')));
});

test('e6 strumenti: dimensione, font, allineamento, indietro avanti, impostazioni', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  for (const id of ['text-size', 'align', 'font', 'undo', 'redo', 'settings']) await esegui(app, { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: id });
  await ed.waitForSelector('.pd-elemento[data-elemento="settings"]', { state: 'attached' });
  await ed.click('#doc');
  await ed.keyboard.type('alfa beta');
  await ed.keyboard.press('Control+A');
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(500);
  await ed.screenshot({ path: `${SHOTS}/tutti.png`, fullPage: true });
  const htmls = await ed.evaluate(() => [...document.querySelectorAll('.pd-elemento')].map((n) => n.dataset.elemento + ': ' + n.querySelector('.pd-contenuto').innerText.replace(/\s+/g, ' ').slice(0, 120)));
  console.log('STRUMENTI', JSON.stringify(htmls, null, 1));
  // indietro
  await ed.locator('.pd-elemento[data-elemento="undo"] button').first().click();
  await ed.waitForTimeout(300);
  console.log('DOPO UNDO', JSON.stringify(await ed.locator('#doc').innerText()), 'aperto', await aperto(ed));
  await ed.locator('.pd-elemento[data-elemento="redo"] button').first().click();
  await ed.waitForTimeout(300);
  console.log('DOPO REDO', JSON.stringify(await ed.locator('#doc').innerText()));
  await ed.locator('.pd-elemento[data-elemento="settings"] button').first().click();
  await ed.waitForTimeout(600);
  await ed.screenshot({ path: `${SHOTS}/impostazioni.png` });
  console.log('IMPOSTAZIONI aperto', await aperto(ed));
});

test('e7 trascina per riordinare nel pannello espanso', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(400);
  await ed.click('.pd-piu');
  await ed.waitForTimeout(300);
  const m = await ed.locator('.pd-elemento[data-elemento="comment"] .pd-maniglia').boundingBox();
  const t = await ed.locator('.pd-elemento[data-elemento="word-count"]').boundingBox();
  await ed.mouse.move(m.x + 3, m.y + 3);
  await ed.mouse.down();
  await ed.mouse.move(m.x + 3, m.y - 20, { steps: 5 });
  await ed.mouse.move(t.x + 20, t.y + 5, { steps: 10 });
  await ed.screenshot({ path: `${SHOTS}/trascina.png` });
  await ed.mouse.up();
  await ed.waitForTimeout(400);
  console.log('ORDINE', JSON.stringify(await elementi(ed)));
  // trascina fuori sul foglio
  const w = await ed.locator('.pd-elemento[data-elemento="search-replace"] .pd-maniglia').boundingBox();
  await ed.mouse.move(w.x + 3, w.y + 3);
  await ed.mouse.down();
  await ed.mouse.move(400, 300, { steps: 15 });
  await ed.mouse.up();
  await ed.waitForTimeout(400);
  console.log('DOPO FUORI', JSON.stringify(await elementi(ed)), 'aperto', await aperto(ed));
});
