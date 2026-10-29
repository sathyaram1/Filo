// Esplorazione giro 4 (si cancella).
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const EDITOR = 'filo://editor/editor.html';
const SHOTS = 'tests/.shots';
mkdirSync(SHOTS, { recursive: true });

async function apriEditor(openTab) {
  const ed = await openTab(EDITOR);
  await ed.waitForSelector('#doc');
  await ed.waitForFunction(() => document.querySelector('.pd-pannello') && document.querySelector('.pd-elemento[data-elemento="word-count"]'));
  return ed;
}
const aperto = (ed) => ed.evaluate(() => document.documentElement.classList.contains('pd-aperto'));
const elementi = (ed) => ed.evaluate(() => [...document.querySelectorAll('.pd-elementi > .pd-elemento')].map((n) => n.dataset.elemento));
const esegui = (app, a) => app.evaluate((_e, x) => globalThis.SN_EXECUTE_FILO_ACTION(x), a);

test('e1 tema scuro e chiaro, tutti gli strumenti, scorrimento del pannello', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.click('#doc');
  await ed.keyboard.type('Una riga di prova per vedere il foglio.');
  for (const id of ['text-size', 'align', 'font', 'undo', 'redo', 'settings', 'bold', 'italic', 'underline']) {
    await esegui(app, { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: id });
  }
  await expect.poll(() => elementi(ed)).toHaveLength(12);
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(400);
  await ed.screenshot({ path: `${SHOTS}/e1-tutti-chiaro.png` });
  const sc = await ed.evaluate(() => { const c = document.querySelector('.pd-corpo'); return { sh: c.scrollHeight, ch: c.clientHeight, ov: getComputedStyle(c).overflowY }; });
  console.log('corpo', JSON.stringify(sc));
  await ed.evaluate(() => { const c = document.querySelector('.pd-corpo'); c.scrollTop = c.scrollHeight; });
  await ed.waitForTimeout(200);
  await ed.screenshot({ path: `${SHOTS}/e1-tutti-chiaro-fondo.png` });
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { theme: 'dark' } }, { url: 'filo://preferences/preferences.html' }));
  await ed.waitForTimeout(800);
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await ed.evaluate(() => { const c = document.querySelector('.pd-corpo'); c.scrollTop = 0; });
  await ed.waitForTimeout(300);
  console.log('tema', await ed.evaluate(() => document.documentElement.dataset.snTheme), 'aperto', await aperto(ed));
  await ed.screenshot({ path: `${SHOTS}/e1-tutti-scuro.png` });
  await ed.click('.pd-piu');
  await ed.waitForTimeout(300);
  await ed.screenshot({ path: `${SHOTS}/e1-espanso-scuro.png` });
});

test('e2 i pulsanti del pannello agiscono sulla selezione del foglio', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  for (const id of ['text-size', 'align', 'undo', 'italic']) await esegui(app, { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: id });
  await ed.click('#doc');
  await ed.keyboard.type('parola uno');
  await ed.keyboard.press('Control+A');
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(300);
  console.log('html-text-size', await ed.locator('.pd-elemento[data-elemento="text-size"] .pd-contenuto').innerHTML());
  console.log('html-align', await ed.locator('.pd-elemento[data-elemento="align"] .pd-contenuto').innerHTML());
  // corsivo con clic vero
  await ed.locator('.pd-elemento[data-elemento="italic"] .pd-contenuto button').first().click();
  await ed.waitForTimeout(300);
  console.log('dopo corsivo', await ed.locator('#doc').innerHTML());
  // allinea al centro con clic vero
  const btns = ed.locator('.pd-elemento[data-elemento="align"] .pd-contenuto button');
  console.log('n align', await btns.count());
  if (await btns.count() > 1) await btns.nth(1).click();
  await ed.waitForTimeout(300);
  console.log('dopo allinea', await ed.locator('#doc').innerHTML());
  const ts = ed.locator('.pd-elemento[data-elemento="text-size"] .pd-contenuto button');
  if (await ts.count()) await ts.last().click();
  await ed.waitForTimeout(300);
  console.log('dopo dimensione', await ed.locator('#doc').innerHTML());
  await ed.screenshot({ path: `${SHOTS}/e2-dopo.png` });
  await ed.locator('.pd-elemento[data-elemento="undo"] .pd-contenuto button').first().click();
  await ed.waitForTimeout(300);
  console.log('dopo indietro', await ed.locator('#doc').innerHTML());
  console.log('aperto', await aperto(ed));
});

test('e3 due schede dell\'Editor: lo strumento aggiunto in una compare nell\'altra; Sposta su', async ({ app, openTab }) => {
  const a = await apriEditor(openTab);
  const b = await apriEditor(openTab);
  await b.evaluate(() => document.querySelector('.pd-striscia').click());
  await b.click('.pd-piu');
  await b.locator('.pd-catalogo .pd-voce[data-elemento="font"]').click();
  await expect.poll(() => elementi(b)).toEqual(['word-count', 'search-replace', 'comment', 'font']);
  await expect.poll(() => elementi(a)).toEqual(['word-count', 'search-replace', 'comment', 'font']);
  await b.click('.pd-piu');
  await b.click('.pd-elemento[data-elemento="font"] .pd-contenuto', { button: 'right', position: { x: 5, y: 5 } });
  console.log('voci', await b.locator('.pd-menu .sn-select-option').allTextContents());
  await b.locator('.pd-menu .sn-select-option', { hasText: 'Sposta su' }).click();
  await expect.poll(() => elementi(a)).toEqual(['word-count', 'search-replace', 'font', 'comment']);
});

test('e4 Aiuto ridotto alla casella e pannello', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1');
  await ed.click('#doc');
  await ed.keyboard.type('Una riga del documento abbastanza lunga da arrivare vicino al bordo della colonna di testo centrale.');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.barra.esegui('help'));
  await expect(ed.locator('.sn-sidebar')).toBeVisible();
  await ed.waitForTimeout(500);
  await ed.mouse.click(200, 300);
  await ed.waitForTimeout(600);
  console.log('aiuto classi', await ed.evaluate(() => document.querySelector('html > .sn-sidebar')?.className), JSON.stringify(await ed.locator('.sn-sidebar').boundingBox()));
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await ed.waitForTimeout(400);
  console.log('pan', JSON.stringify(await ed.locator('.pd-pannello').boundingBox()), 'vw', await ed.evaluate(() => innerWidth));
  await ed.screenshot({ path: `${SHOTS}/e4-aiuto-ridotto-pannello.png` });
  await ed.click('.pd-lucchetto');
  await ed.waitForTimeout(400);
  console.log('doc', JSON.stringify(await ed.locator('#doc').boundingBox()), 'pan', JSON.stringify(await ed.locator('.pd-pannello').boundingBox()));
  await ed.screenshot({ path: `${SHOTS}/e4-aiuto-ridotto-bloccato.png` });
});

test('e5 pagina web: niente striscia, niente pannello, Ctrl+\\ passa', async ({ app, openTab, testServer }) => {
  const p = await testServer.openReady(openTab, '<p>ciao</p>');
  console.log('striscia web', await p.evaluate(() => !!document.querySelector('.pd-striscia, .pd-pannello')));
  const r = await esegui(app, { type: 'PANNELLO_APP', operazione: 'apri' });
  console.log('apri su web', JSON.stringify(r));
});

test('e6 si scrive nel Cerca, il puntatore va sul foglio: il pannello resta?', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.click('#doc');
  await ed.keyboard.type('il gatto e il cane e il topo');
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(300);
  await ed.click('.pd-elemento[data-elemento="search-replace"] [data-sr="find"]');
  await ed.keyboard.type('il');
  await ed.mouse.move(400, 300, { steps: 5 });
  await ed.waitForTimeout(900);
  console.log('aperto dopo uscita col fuoco nel campo', await aperto(ed), 'fuoco', await ed.evaluate(() => document.activeElement?.dataset?.sr || document.activeElement?.id || document.activeElement?.tagName));
  await ed.keyboard.type(' gatto');
  console.log('campo', await ed.locator('[data-sr="find"]').inputValue(), 'doc', await ed.locator('#doc').innerText());
});

test('e7 selezione, clic vero sulla striscia, clic vero su Grassetto e Commenta', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: 'bold' });
  await ed.click('#doc');
  await ed.keyboard.type('alfa beta gamma');
  await ed.keyboard.press('Control+A');
  const s = await ed.locator('.pd-striscia').boundingBox();
  await ed.mouse.click(s.x + s.width / 2, 400);
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(300);
  console.log('selezione dopo striscia', JSON.stringify(await ed.evaluate(() => String(getSelection()))));
  await ed.locator('.pd-elemento[data-elemento="bold"] .pd-contenuto button').first().click();
  await ed.waitForTimeout(300);
  console.log('dopo grassetto', await ed.locator('#doc').innerHTML());
  await ed.locator('.pd-elemento[data-elemento="comment"] .pd-contenuto button').first().click();
  await ed.waitForTimeout(500);
  console.log('overlay', await ed.evaluate(() => !document.getElementById('overlay')?.hidden), 'commenting', await ed.evaluate(() => document.querySelector('.ed-root')?.className));
  await ed.screenshot({ path: `${SHOTS}/e7-commenta.png` });
});

test('e8 Preferenze: striscia spenta, link Regola il pannello', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.click('.pd-striscia', { button: 'right', force: true });
  console.log('voci striscia', await ed.locator('.pd-menu .sn-select-option').allTextContents());
  await ed.locator('.pd-menu .sn-select-option', { hasText: 'Regola il pannello' }).click();
  await ed.waitForTimeout(1500);
  const pr = app.windows().find((w) => { try { return w.url().startsWith('filo://preferences'); } catch (_) { return false; } });
  console.log('preferenze aperte', !!pr, pr && pr.url());
  if (pr) {
    await pr.waitForSelector('#pannelloStriscia', { state: 'attached' });
    console.log('visibile', await pr.locator('#sec-pannello').isVisible(), JSON.stringify(await pr.locator('#sec-pannello').boundingBox()));
    await pr.screenshot({ path: `${SHOTS}/e8-preferenze.png` });
    await pr.locator('#pannelloStriscia').uncheck();
    await pr.locator('#pannelloAttesa').fill('5');
    await pr.locator('#pannelloAttesa').blur();
    await pr.waitForTimeout(800);
    console.log('salvate', JSON.stringify(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).pannelloDestro)));
    console.log('valore campo', await pr.locator('#pannelloAttesa').inputValue());
  }
  console.log('senza striscia', await ed.evaluate(() => document.documentElement.classList.contains('pd-senza-striscia')));
});

test('e9 selezione, Ctrl+\\ e clic su Grassetto; poi clic sulla striscia e A+', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: 'bold' });
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: 'align' });
  await ed.click('#doc');
  await ed.keyboard.type('alfa beta gamma');
  await ed.keyboard.press('Control+A');
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const wc = win._filoTabs.tabs.find((x) => x.id === win._filoTabs.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: '\\', modifiers: ['control'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: '\\', modifiers: ['control'] });
  });
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(300);
  await ed.locator('.pd-elemento[data-elemento="bold"] .pd-contenuto button').first().click();
  await ed.waitForTimeout(300);
  console.log('tasto: dopo grassetto', await ed.locator('#doc').innerHTML());
  await ed.mouse.click(300, 300);
  await expect.poll(() => aperto(ed)).toBe(false);
  await ed.locator('#doc').click();
  await ed.keyboard.press('Control+A');
  const s = await ed.locator('.pd-striscia').boundingBox();
  await ed.mouse.click(s.x + s.width / 2, 400);
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(300);
  await ed.locator('.pd-elemento[data-elemento="align"] [data-align="center"]').click();
  await ed.waitForTimeout(300);
  console.log('striscia: dopo centro', await ed.locator('#doc').innerHTML());
});

test('e10 selezione, pannello bloccato, clic sul numero del conteggio, poi Grassetto', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: 'bold' });
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'blocca' });
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.click('#doc');
  await ed.keyboard.type('alfa beta gamma');
  await ed.keyboard.press('Control+A');
  await ed.locator('.pd-elemento[data-elemento="word-count"]').click();
  await ed.waitForTimeout(200);
  console.log('sel', JSON.stringify(await ed.evaluate(() => String(getSelection()))));
  await ed.locator('.pd-elemento[data-elemento="bold"] .pd-contenuto button').first().click();
  await ed.waitForTimeout(300);
  console.log('dopo grassetto', await ed.locator('#doc').innerHTML());
});
