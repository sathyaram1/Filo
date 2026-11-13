// #2470: un Filo aperto da una prova non parla coi servizi veri di Filo. Ogni lancio con un profilo nuovo creava un
// utente anonimo vero e chiamava le funzioni dei crediti (13 mila iscrizioni al giorno). Regola: src/main/test-servizi-chiusi.js.

import { test, expect } from './fixtures/electron.mjs';

const CHIUSI = ['identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'europe-west1-filo-8b9cb.cloudfunctions.net'];

test('al primo avvio la lettura dei crediti non arriva alla produzione', async ({ app }) => {
  test.setTimeout(60_000);
  const err = [];
  app.process().stderr?.on('data', (b) => err.push(b.toString('utf8')));
  // Ogni richiesta che il fetch del main crea davvero passa da qui, prima di andare in rete.
  await app.evaluate(() => {
    const dc = process.mainModule.require('node:diagnostics_channel');
    globalThis.__richiesteUscite = [];
    dc.subscribe('undici:request:create', ({ request }) => {
      globalThis.__richiesteUscite.push(String(request.origin || ''));
    });
  });
  // La lettura dello stato dei crediti parte quattro secondi dopo l'avvio e chiede prima l'identità anonima.
  await expect.poll(() => err.join(''), { timeout: 30_000 })
    .toContain('[test] servizio chiuso: identitytoolkit.googleapis.com');
  const uscite = await app.evaluate(() => globalThis.__richiesteUscite.slice());
  const versoFilo = uscite.filter((o) => CHIUSI.some((h) => o.includes(h)));
  expect(versoFilo, `richieste partite verso i servizi veri: ${versoFilo.join(', ')}`).toEqual([]);
});
