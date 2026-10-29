// Verifica #1433, giro 4, rilievo 3: col pannello espanso il nome di «Impostazioni degli strumenti» sta su una riga,
// allineato come quello degli altri strumenti.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

test('r3 pannello espanso: il nome di Impostazioni degli strumenti è alto una riga come quello del Grassetto', async ({ app, openTab }) => {
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForFunction(() => document.querySelector('.pd-pannello') && document.querySelector('.pd-elemento[data-elemento="word-count"]'));
  for (const id of ['settings', 'bold']) {
    await app.evaluate((_e, el) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: el }), id);
  }
  await ed.waitForSelector('.pd-elemento[data-elemento="bold"]', { state: 'attached' });
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => ed.evaluate(() => document.documentElement.classList.contains('pd-aperto'))).toBe(true);
  await ed.click('.pd-piu');
  await ed.waitForTimeout(400);
  mkdirSync('tests/.shots', { recursive: true });
  await ed.screenshot({ path: 'tests/.shots/giro4-r3-espanso.png' });
  const h = await ed.evaluate(() => {
    const alto = (id) => document.querySelector(`.pd-elemento[data-elemento="${id}"] .ed-fmt-nome`).getBoundingClientRect().height;
    return { impostazioni: alto('settings'), grassetto: alto('bold') };
  });
  expect(h.impostazioni).toBeLessThanOrEqual(h.grassetto + 1);
});
