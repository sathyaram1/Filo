// Verifica #1433, giro 4, rilievo 1: un clic sulla striscia o su un punto vuoto del pannello non toglie la selezione
// del foglio, e gli strumenti di formattazione del pannello la usano (come aprendolo col tasto).

import { test, expect } from '../../fixtures/electron.mjs';

async function prepara(app, openTab, elemento) {
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForFunction(() => document.querySelector('.pd-pannello') && document.querySelector('.pd-elemento[data-elemento="word-count"]'));
  await app.evaluate((_e, el) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: el }), elemento);
  await ed.waitForSelector(`.pd-elemento[data-elemento="${elemento}"]`, { state: 'attached' });
  return ed;
}
const aperto = (ed) => ed.evaluate(() => document.documentElement.classList.contains('pd-aperto'));

test('r1 testo selezionato, clic sulla striscia, clic su Grassetto nel pannello: il testo diventa grassetto', async ({ app, openTab }) => {
  const ed = await prepara(app, openTab, 'bold');
  await ed.click('#doc');
  await ed.keyboard.type('alfa beta gamma');
  await ed.keyboard.press('Control+A');
  const s = await ed.locator('.pd-striscia').boundingBox();
  await ed.mouse.click(s.x + s.width / 2, 400);
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(300);
  await ed.locator('.pd-elemento[data-elemento="bold"] .pd-contenuto button').first().click();
  await expect(ed.locator('#doc b, #doc strong')).toHaveText('alfa beta gamma', { timeout: 3000 });
});

test('r1 due paragrafi selezionati, clic sulla striscia, Allinea a destra: tutti e due a destra', async ({ app, openTab }) => {
  const ed = await prepara(app, openTab, 'align');
  await ed.click('#doc');
  await ed.keyboard.type('primo paragrafo');
  await ed.keyboard.press('Enter');
  await ed.keyboard.type('secondo paragrafo');
  await ed.keyboard.press('Control+A');
  const s = await ed.locator('.pd-striscia').boundingBox();
  await ed.mouse.click(s.x + s.width / 2, 400);
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(300);
  await ed.locator('.pd-elemento[data-elemento="align"] button[data-align="right"]').click();
  await expect.poll(() => ed.evaluate(() => [...document.querySelectorAll('#doc > *')].map((n) => getComputedStyle(n).textAlign))).toEqual(['right', 'right']);
});

test('r1 aperto col tasto, un clic sul vuoto in cima al pannello, poi Grassetto: il testo selezionato diventa grassetto', async ({ app, openTab }) => {
  const ed = await prepara(app, openTab, 'bold');
  await ed.click('#doc');
  await ed.keyboard.type('alfa beta gamma');
  await ed.keyboard.press('Control+A');
  await ed.keyboard.press('Control+Backslash');
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(300);
  const t = await ed.locator('.pd-testa').boundingBox();
  await ed.mouse.click(t.x + 10, t.y + t.height / 2);
  await ed.locator('.pd-elemento[data-elemento="bold"] .pd-contenuto button').first().click();
  await expect(ed.locator('#doc b, #doc strong')).toHaveText('alfa beta gamma', { timeout: 3000 });
});
