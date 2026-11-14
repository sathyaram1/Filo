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
  // La lettura dello stato dei crediti parte quattro secondi dopo l'avvio e chiede prima l'identità anonima:
  // si aspetta che ci abbia provato, fermata dalla chiusura o uscita davvero.
  const versoFilo = async () => (await app.evaluate(() => globalThis.__richiesteUscite.slice()))
    .filter((o) => CHIUSI.some((h) => o.includes(h)));
  await expect.poll(async () => err.join('').includes('[test] servizio chiuso: identitytoolkit.googleapis.com')
    || (await versoFilo()).length > 0, { timeout: 30_000 }).toBe(true);
  const uscite = await versoFilo();
  expect(uscite, `richieste partite verso i servizi veri: ${uscite.join(', ')}`).toEqual([]);
});
