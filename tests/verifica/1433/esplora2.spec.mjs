// Esplorazione del giro 5: si cancella.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const EDITOR = 'filo://editor/editor.html';
const SHOTS = 'tests/.shots/v1433g5';
mkdirSync(SHOTS, { recursive: true });
const aperto = (ed) => ed.evaluate(() => document.documentElement.classList.contains('pd-aperto'));
async function apri(openTab) {
  const ed = await openTab(EDITOR);
  await ed.waitForFunction(() => document.querySelector('.pd-pannello') && document.querySelector('.pd-elemento[data-elemento="word-count"]'));
  return ed;
}
const metti = (app, el) => app.evaluate((_e, el) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: el }), el);
const elementi = (ed) => ed.evaluate(() => [...document.querySelectorAll('.pd-elementi > .pd-elemento')].map((n) => n.dataset.elemento));

test('espanso: si scrive ancora in Cerca', async ({ openTab }) => {
  const ed = await apri(openTab);
  await ed.click('#doc');
  await ed.keyboard.type('il gatto e il cane');
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.click('.pd-piu');
  await ed.click('.pd-elemento[data-elemento="search-replace"] [data-sr="find"]');
  await ed.keyboard.type('gatto');
  const v = await ed.inputValue('.pd-elemento[data-elemento="search-replace"] [data-sr="find"]');
  console.log('ESPANSO cerca =', JSON.stringify(v), 'doc =', await ed.locator('#doc').innerText());
});

test('trascina dal catalogo col mouse dentro, poi fuori', async ({ openTab }) => {
  const ed = await apri(openTab);
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(300);
  await ed.click('.pd-piu');
  const v = await ed.locator('.pd-catalogo .pd-voce[data-elemento="italic"]').boundingBox();
  const primo = await ed.locator('.pd-elementi .pd-elemento').first().boundingBox();
  await ed.mouse.move(v.x + 20, v.y + 10);
  await ed.mouse.down();
  await ed.mouse.move(v.x + 30, v.y - 20, { steps: 4 });
  await ed.mouse.move(primo.x + 50, primo.y + 5, { steps: 8 });
  await ed.mouse.up();
  await expect.poll(() => elementi(ed)).toEqual(['italic', 'word-count', 'search-replace', 'comment']);
  const it = await ed.locator('.pd-elementi .pd-elemento[data-elemento="italic"]').boundingBox();
  await ed.mouse.move(it.x + 40, it.y + 10);
  await ed.mouse.down();
  await ed.mouse.move(it.x - 100, it.y + 10, { steps: 5 });
  await ed.mouse.move(300, 300, { steps: 8 });
  await ed.mouse.up();
  await expect.poll(() => elementi(ed)).toEqual(['word-count', 'search-replace', 'comment']);
  console.log('dopo trascinamento fuori aperto =', await aperto(ed));
});

test('pannello vuoto: si vede cosa fare', async ({ app, openTab }) => {
  const ed = await apri(openTab);
  for (const el of ['word-count', 'search-replace', 'comment']) await app.evaluate((_e, el) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'PANNELLO_APP', operazione: 'togli', elemento: el }), el);
  await expect.poll(() => elementi(ed)).toEqual([]);
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await ed.waitForTimeout(400);
  await ed.screenshot({ path: `${SHOTS}/vuoto.png` });
});

test('Indietro e Font dal pannello aperto con la striscia', async ({ app, openTab }) => {
  const ed = await apri(openTab);
  await metti(app, 'undo');
  await metti(app, 'font');
  await metti(app, 'text-size');
  await ed.waitForSelector('.pd-elemento[data-elemento="font"]', { state: 'attached' });
  await ed.click('#doc');
  await ed.keyboard.type('alfa beta');
  await ed.waitForTimeout(700);
  await ed.keyboard.type(' gamma');
  await ed.keyboard.press('Control+A');
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(300);
  await ed.screenshot({ path: `${SHOTS}/font-size-undo.png` });
  console.log('FONT html', await ed.locator('.pd-elemento[data-elemento="font"] .pd-contenuto').innerHTML());
  console.log('SIZE html', await ed.locator('.pd-elemento[data-elemento="text-size"] .pd-contenuto').innerHTML());
  await ed.locator('.pd-elemento[data-elemento="undo"] button').first().click();
  await ed.waitForTimeout(300);
  console.log('dopo indietro:', JSON.stringify(await ed.locator('#doc').innerText()), 'aperto', await aperto(ed));
});
