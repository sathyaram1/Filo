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
const esegui = (app, a) => app.evaluate((_e, x) => globalThis.SN_EXECUTE_FILO_ACTION(x), a);

test('h1 Esc dal campo Cerca col pannello aperto dalla striscia', async ({ openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.click('#doc');
  await ed.keyboard.type('alfa beta gamma');
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.click('[data-sr="find"]');
  await ed.keyboard.type('beta');
  await ed.keyboard.press('Escape');
  await ed.waitForTimeout(400);
  console.log('H1 dopo Esc aperto', await aperto(ed), 'focus', await ed.evaluate(() => document.activeElement.id || document.activeElement.dataset.sr || document.activeElement.tagName));
  await ed.keyboard.press('Escape');
  await ed.waitForTimeout(400);
  console.log('H1 dopo 2 Esc aperto', await aperto(ed), 'focus', await ed.evaluate(() => document.activeElement.id || document.activeElement.dataset.sr || document.activeElement.tagName));
  await ed.keyboard.type('Z');
  console.log('H1 testo', await ed.locator('#doc').innerText(), 'campo', await ed.inputValue('[data-sr="find"]'));
});

test('h2 titoli dei pulsanti nel pannello', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  for (const id of ['text-size', 'align', 'font', 'undo', 'redo', 'settings', 'bold', 'italic', 'underline']) await esegui(app, { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: id });
  await ed.waitForSelector('.pd-elemento[data-elemento="underline"]', { state: 'attached' });
  const t = await ed.evaluate(() => [...document.querySelectorAll('.pd-pannello button, .pd-pannello select')].map((b) => `${b.closest('.pd-elemento')?.dataset.elemento || 'testa'}:${(b.innerText || '').trim().slice(0, 12)}|${b.title || b.getAttribute('aria-label') || '-'}`));
  console.log('H2', JSON.stringify(t, null, 1));
});

test('h3 clic su voce del catalogo; pannello vuoto', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.click('.pd-piu');
  await ed.locator('.pd-catalogo > *', { hasText: 'Grassetto' }).first().click();
  await ed.waitForTimeout(400);
  console.log('H3 dopo clic catalogo', JSON.stringify(await elementi(ed)), 'espanso', await ed.evaluate(() => !document.querySelector('.pd-catalogo').hidden));
  for (const id of ['conteggio', 'cerca', 'commenta', 'grassetto']) console.log('togli', id, JSON.stringify(await esegui(app, { type: 'PANNELLO_APP', operazione: 'togli', elemento: id })));
  await ed.waitForTimeout(400);
  console.log('H3 vuoto', JSON.stringify(await elementi(ed)));
  await ed.click('.pd-piu').catch(() => {});
  await ed.waitForTimeout(300);
  await ed.click('.pd-piu').catch(() => {});
  await ed.waitForTimeout(300);
  await ed.screenshot({ path: `${SHOTS}/h3-vuoto.png` });
  // Ctrl+F con Cerca tolto
  await ed.click('#doc');
  await ed.keyboard.type('uno due');
  await ed.keyboard.press('Control+f');
  await ed.waitForTimeout(500);
  console.log('H3 Ctrl+F dopo togli', JSON.stringify(await elementi(ed)), await aperto(ed));
});

test('h4 conteggio caratteri dalle impostazioni dell elemento', async ({ openTab }) => {
  const ed = await apriEditor(openTab);
  await ed.click('#doc');
  await ed.keyboard.type('ciao mondo');
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(400);
  await ed.locator('.pd-elemento[data-elemento="word-count"]').click({ button: 'right' });
  await ed.getByText(/Impostazioni di/).first().click();
  await ed.waitForTimeout(500);
  await ed.screenshot({ path: `${SHOTS}/h4-conteggio.png` });
  console.log('H4 overlay', JSON.stringify(await ed.evaluate(() => document.querySelector('#overlay')?.innerText)));
});

test('h5 dimensione testo e font sulla selezione', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  for (const id of ['text-size', 'font']) await esegui(app, { type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: id });
  await ed.waitForSelector('.pd-elemento[data-elemento="font"]', { state: 'attached' });
  await ed.click('#doc');
  await ed.keyboard.type('alfa beta');
  await ed.keyboard.press('Shift+Home');
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(300);
  await ed.locator('.pd-elemento[data-elemento="text-size"] button').last().click();
  await ed.waitForTimeout(300);
  console.log('H5 dopo A+', await ed.locator('#doc').innerHTML());
  const sel = ed.locator('.pd-elemento[data-elemento="font"] select');
  if (await sel.count()) { await sel.selectOption({ index: 3 }); } else { await ed.locator('.pd-elemento[data-elemento="font"] button').first().click(); await ed.waitForTimeout(300); await ed.screenshot({ path: `${SHOTS}/h5-font.png` }); await ed.keyboard.press('ArrowDown'); await ed.keyboard.press('ArrowDown'); await ed.keyboard.press('Enter'); }
  await ed.waitForTimeout(300);
  console.log('H5 dopo font', await ed.locator('#doc').innerHTML(), 'aperto', await aperto(ed));
});

test('h6 bloccato e ricarica', async ({ app, openTab }) => {
  const ed = await apriEditor(openTab);
  await esegui(app, { type: 'PANNELLO_APP', operazione: 'blocca' });
  await expect.poll(() => ed.evaluate(() => document.documentElement.classList.contains('pd-bloccato'))).toBe(true);
  await ed.reload();
  await ed.waitForSelector('.pd-elemento[data-elemento="word-count"]', { state: 'attached' });
  await ed.waitForTimeout(800);
  console.log('H6 dopo ricarica', await ed.evaluate(() => document.documentElement.className));
});
