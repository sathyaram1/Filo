// #1551 giro 1, rilievo 2: a 900 punti con tre avvisi in pila il campo stretto non tiene più il segnaposto
// su una riga, e nel campo compaiono le frecce di una barra di scorrimento.
import { test, expect } from '../../fixtures/electron.mjs';
import { homeLarga } from './aiuto.mjs';

test('r2 tre avvisi a 900 punti: il campo vuoto della home resta su una riga, senza scorrimento', async ({ app, shell }) => {
  const page = await homeLarga(app, 900, 700);
  await shell.evaluate(() => {
    window.filoNotify('Il catalogo è pronto: 14 pagine, 3 offerte nuove', { durationSec: 0 });
    window.filoNotify('Secondo avviso piuttosto lungo che va su due righe forse, vediamo cosa succede qui', { durationSec: 0 });
    window.filoNotify('Il portachiavi di sistema non risponde: l’accesso vale fino alla chiusura di Filo', { durationSec: 0, actions: [{ label: 'Capito', onClick() {} }] });
  });
  const larghezza = () => page.evaluate(() => document.querySelector('#input').clientWidth);
  const iniziale = await larghezza();
  await expect.poll(larghezza, { timeout: 10_000 }).toBeLessThan(iniziale);
  await page.waitForTimeout(800);
  const t = await page.evaluate(() => { const e = document.querySelector('#input'); return { sh: e.scrollHeight, ch: e.clientHeight }; });
  expect(t.sh, 'il segnaposto va a capo e il campo scorre').toBeLessThanOrEqual(t.ch);
});
