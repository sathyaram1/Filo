// #1551 giro 1, rilievo 1: con la finestra sotto gli 840 punti il campo della home smette di stringersi e un
// avviso lungo copre ancora il tasto Invia (a 720, la larghezza minima, tutto).
import { test, expect } from '../../fixtures/electron.mjs';
import { homeLarga, invioEcarte } from './aiuto.mjs';

for (const W of [720, 800]) {
  test(`r1 finestra larga ${W}: l'avviso lungo lascia libero il tasto Invia della home`, async ({ app, shell, avvisi }) => {
    const page = await homeLarga(app, W, 700);
    await shell.evaluate(() => window.filoNotify('Il catalogo è pronto: 14 pagine, 3 offerte nuove', { durationSec: 0 }));
    await expect.poll(async () => (await invioEcarte(app, page, avvisi)).cartaSinistra, { timeout: 10_000 }).toBeLessThan(Infinity);
    await expect.poll(async () => {
      const m = await invioEcarte(app, page, avvisi);
      return m.invioDestra <= m.cartaSinistra;
    }, { timeout: 5_000, message: 'il tasto Invia finisce sotto la carta dell’avviso' }).toBe(true);
  });
}
