// VERIFICA #728 giro 1, rilievo 3 — una parola comune a due lettere da un marchio
// lungo (telegraph/Telegram, linked/LinkedIn, codebase/Coinbase) non deve aprire
// da sola il blocco a tutta pagina; il sosia a una lettera sì.

import { test, expect } from '../../fixtures/electron.mjs';

test('parole comuni a due lettere da un marchio lungo: niente blocco senza un altro segnale', async ({ app }) => {
  const livelli = await app.evaluate(() => {
    const SB = globalThis.SN_SAFEBROWSE;
    const out = {};
    for (const u of ['https://www.telegraph.co.uk/', 'https://telegramma.it/', 'https://www.telegrafo.it/',
      'https://linked.com/', 'https://codebase.com/', 'https://whatsup.com/', 'https://instagarm.com/']) {
      out[new URL(u).hostname] = SB.checkSync(u, {}).level;
    }
    return out;
  });
  for (const h of ['www.telegraph.co.uk', 'telegramma.it', 'www.telegrafo.it', 'linked.com', 'codebase.com', 'whatsup.com']) {
    expect(livelli[h], h).not.toBe('pericoloso');
  }
  // Il sosia vero, a una lettera dal marchio lungo, resta bloccato.
  expect(livelli['instagarm.com']).toBe('pericoloso');
});
