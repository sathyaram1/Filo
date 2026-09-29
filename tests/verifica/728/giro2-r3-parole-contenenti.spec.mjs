// VERIFICA #728 giro 2, rilievo 3 — una parola comune che CONTIENE un marchio corto
// (purchase/Chase, otherwise/Wise, pineapple/Apple, poster/Poste) non deve aprire da
// sola il popup di somiglianza; il sosia che accosta il marchio a un'altra parola sì.

import { test, expect } from '../../fixtures/electron.mjs';

test('parole comuni che contengono un marchio corto: nessun avviso senza un altro segnale', async ({ app }) => {
  const livelli = await app.evaluate(() => {
    const SB = globalThis.SN_SAFEBROWSE;
    const out = {};
    for (const u of ['https://purchase.com/', 'https://otherwise.com/', 'https://likewise.com/', 'https://pineapple.com/',
      'https://www.posterlounge.it/', 'https://pinstripe.com/', 'https://steamboat.com/', 'https://paypal-login.com/']) {
      out[new URL(u).hostname] = SB.checkSync(u, {}).level;
    }
    return out;
  });
  for (const h of ['purchase.com', 'otherwise.com', 'likewise.com', 'pineapple.com', 'www.posterlounge.it', 'pinstripe.com',
    'steamboat.com']) {
    expect(livelli[h], h).toBe('safe');
  }
  // Il combosquat vero resta un avviso.
  expect(livelli['paypal-login.com']).not.toBe('safe');
});
