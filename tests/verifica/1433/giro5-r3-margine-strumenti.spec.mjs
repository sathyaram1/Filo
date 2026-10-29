// Verifica #1433, giro 5, rilievo 3: nel pannello ogni strumento tiene i suoi comandi alla stessa distanza dalla
// cornice: Indietro, Font e Dimensione testo come Conteggio, Cerca e Commenta.
import { test, expect } from '../../fixtures/electron.mjs';

test('r3 i comandi di ogni strumento cominciano alla stessa distanza dalla cornice', async ({ app, openTab }) => {
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForFunction(() => document.querySelector('.pd-pannello') && document.querySelector('.pd-elemento[data-elemento="comment"]'));
  for (const el of ['undo', 'font', 'text-size']) {
    await app.evaluate((_e, el) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'PANNELLO_APP', operazione: 'aggiungi', elemento: el }), el);
  }
  await ed.waitForSelector('.pd-elemento[data-elemento="text-size"]', { state: 'attached' });
  await ed.evaluate(() => document.querySelector('.pd-striscia').click());
  await expect.poll(() => ed.evaluate(() => document.documentElement.classList.contains('pd-aperto'))).toBe(true);
  await ed.waitForTimeout(400);
  const margini = await ed.evaluate(() => Object.fromEntries(['comment', 'search-replace', 'undo', 'font', 'text-size'].map((id) => {
    const sez = document.querySelector(`.pd-elemento[data-elemento="${id}"]`);
    const ctl = sez.querySelector('.pd-contenuto button, .pd-contenuto input');
    return [id, Math.round(ctl.getBoundingClientRect().left - sez.getBoundingClientRect().left)];
  })));
  expect(new Set(Object.values(margini)).size, JSON.stringify(margini)).toBe(1);
});
