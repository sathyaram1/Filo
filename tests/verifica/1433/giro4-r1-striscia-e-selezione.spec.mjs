// Verifica #1433, giro 4, rilievo 1: aperto il pannello con un clic sulla striscia, la selezione del foglio resta e
// il Grassetto del pannello la mette in grassetto (come aprendolo col tasto).

import { test, expect } from '../../fixtures/electron.mjs';

test('r1 testo selezionato, clic sulla striscia, clic su Grassetto nel pannello: il testo diventa grassetto', async ({ app, openTab }) => {
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForFunction(() => document.querySelector('.pd-pannello') && document.querySelector('.pd-elemento[data-elemento="word-count"]'));
  await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: 'bold' }));
  await ed.waitForSelector('.pd-elemento[data-elemento="bold"]', { state: 'attached' });
  await ed.click('#doc');
  await ed.keyboard.type('alfa beta gamma');
  await ed.keyboard.press('Control+A');
  const s = await ed.locator('.pd-striscia').boundingBox();
  await ed.mouse.click(s.x + s.width / 2, 400);
  await expect.poll(() => ed.evaluate(() => document.documentElement.classList.contains('pd-aperto'))).toBe(true);
  await ed.waitForTimeout(300);
  await ed.locator('.pd-elemento[data-elemento="bold"] .pd-contenuto button').first().click();
  await expect(ed.locator('#doc b, #doc strong')).toHaveText('alfa beta gamma', { timeout: 3000 });
});
