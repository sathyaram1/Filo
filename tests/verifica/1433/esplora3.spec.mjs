// Esplorazione del giro 5: si cancella.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';
const aperto = (ed) => ed.evaluate(() => document.documentElement.classList.contains('pd-aperto'));
async function apri(openTab) {
  const ed = await openTab(EDITOR);
  await ed.waitForFunction(() => document.querySelector('.pd-pannello') && document.querySelector('.pd-elemento[data-elemento="word-count"]'));
  return ed;
}
const metti = (app, el) => app.evaluate((_e, el) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: el }), el);

test('Font cercato nel suo campo, dal pannello aperto con la striscia', async ({ app, openTab }) => {
  const ed = await apri(openTab);
  await metti(app, 'font');
  await ed.waitForSelector('.pd-elemento[data-elemento="font"]', { state: 'attached' });
  await ed.click('#doc');
  await ed.keyboard.type('alfa beta gamma');
  await ed.keyboard.press('Control+A');
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(300);
  await ed.click('.pd-elemento[data-elemento="font"] .ed-font-button');
  await ed.click('.ed-font-search');
  await ed.keyboard.type('Geor');
  await ed.waitForTimeout(300);
  await ed.locator('.ed-font-pop .sn-select-option', { hasText: 'Georgia' }).click();
  await ed.waitForTimeout(300);
  console.log('FONT doc html', await ed.locator('#doc').innerHTML(), 'aperto', await aperto(ed));
});

test('Font scelto senza cercare, e A+, dal pannello aperto con la striscia', async ({ app, openTab }) => {
  const ed = await apri(openTab);
  await metti(app, 'font');
  await metti(app, 'text-size');
  await ed.waitForSelector('.pd-elemento[data-elemento="text-size"]', { state: 'attached' });
  await ed.click('#doc');
  await ed.keyboard.type('alfa beta gamma');
  await ed.keyboard.press('Control+A');
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.waitForTimeout(300);
  await ed.click('.pd-elemento[data-elemento="text-size"] [data-size="up"]');
  await ed.waitForTimeout(200);
  console.log('SIZE doc html', await ed.locator('#doc').innerHTML());
  await ed.click('.pd-elemento[data-elemento="font"] .ed-font-button');
  await ed.waitForTimeout(400);
  await ed.screenshot({ path: 'tests/.shots/v1433g5/font-pop.png' });
  console.log('POP', await ed.evaluate(() => { const p = document.querySelector('.ed-font-pop'); const r = p.getBoundingClientRect(); return { hidden: p.hidden, r: [r.x, r.y, r.width, r.height], parent: p.parentElement.className }; }));
  const o = ed.locator('.ed-font-pop .sn-select-option', { hasText: 'Courier New' });
  console.log('OPT', await o.evaluate((n) => { const r = n.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
  await o.scrollIntoViewIfNeeded();
  await ed.waitForTimeout(300);
  console.log('POP dopo scroll', await ed.evaluate(() => document.querySelector('.ed-font-pop').hidden));
  await ed.screenshot({ path: 'tests/.shots/v1433g5/font-pop2.png' });
  await o.click({ timeout: 3000 });
  await ed.waitForTimeout(300);
  console.log('FONT2 doc html', await ed.locator('#doc').innerHTML(), 'aperto', await aperto(ed));
});

test('Indietro dal pannello e Ctrl+Z fanno lo stesso', async ({ app, openTab }) => {
  const ed = await apri(openTab);
  await metti(app, 'undo');
  await ed.waitForSelector('.pd-elemento[data-elemento="undo"]', { state: 'attached' });
  await ed.click('#doc');
  await ed.keyboard.type('alfa beta gamma');
  await ed.keyboard.press('Control+Z');
  const z = await ed.locator('#doc').innerText();
  await ed.keyboard.type('X');
  await ed.keyboard.press('Control+A');
  await ed.keyboard.press('Delete');
  await ed.keyboard.type('alfa beta gamma');
  await ed.keyboard.press('Control+\\');
  await expect.poll(() => aperto(ed)).toBe(true);
  await ed.locator('.pd-elemento[data-elemento="undo"] button').first().click();
  const u = await ed.locator('#doc').innerText();
  console.log('CTRLZ', JSON.stringify(z), 'INDIETRO', JSON.stringify(u));
});
