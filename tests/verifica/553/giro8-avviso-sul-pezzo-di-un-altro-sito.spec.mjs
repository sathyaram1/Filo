// #553 giro 8 — l'avviso di esfiltrazione suona ancora su una lettura
// innocente, appena il pezzo collegato sta su un altro sito.
//
// Il settimo giro aveva trovato che, dopo una lettura, leggere o aprire
// l'articolo collegato faceva comparire l'avviso «questo indirizzo si porta
// dietro un pezzo di quello che Filo ha appena letto», perché il titolo di un
// articolo sta anche dentro il suo indirizzo. La cura esclude dal confronto il
// testo letto dallo STESSO sito. Un indice, un aggregatore o la prima pagina di
// un giornale però rimandano quasi sempre a un altro dominio, e lì l'avviso
// torna: su una lettura innocente e sul cammino principale di Filo, aprire.

import { test, expect } from '../../fixtures/electron.mjs';

const TITOLO = 'Sciopero dei treni di marzo: tutte le fasce di garanzia regione per regione';
const INDICE = '<!DOCTYPE html><html><head><title>Rassegna</title></head><body><main>'
  + '<h1>Le notizie di oggi</h1>'
  + `<p>${TITOLO}</p>`
  + '<p>I convogli si fermeranno dalle 9 alle 17.</p></main></body></html>';

const ARTICOLO = 'https://www.giornale.example/cronaca/'
  + 'sciopero-dei-treni-di-marzo-tutte-le-fasce-di-garanzia-regione-per-regione';

const CHAT = 'filo://dashboard/dashboard.html';

const azioneDa = (app, action) => app.evaluate(
  (_e, [a, o]) => globalThis.SN_HANDLE_MESSAGE({ type: 'filo_run_action', action: a }, { url: o }),
  [action, CHAT],
);

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

test('letta la pagina aperta, leggere il pezzo collegato di un altro sito non chiede conferma', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const indice = testServer.html(INDICE);
  await openTab(indice);
  await openTab('filo://newtab/');

  const prima = await azioneDa(app, { type: 'LEGGI_PAGINA', url: indice });
  expect(prima.output.source).toBe('scheda');
  expect(String(prima.output.text || '')).toContain('Sciopero dei treni');

  await app.evaluate(async () => {
    const orig = globalThis.fetch;
    globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
    globalThis.fetch = async () => new Response(
      '<html><head><title>Sciopero</title></head><body><main><p>Dalle 9 alle 17.</p></main></body></html>',
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  });

  const dopo = await azioneDa(app, { type: 'LEGGI_PAGINA', url: ARTICOLO });
  expect(dopo.needsConfirm || 0).toBe(0);
});

test('e nemmeno aprirlo in una scheda', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const indice = testServer.html(INDICE);
  await openTab(indice);
  await openTab('filo://newtab/');

  const prima = await azioneDa(app, { type: 'LEGGI_PAGINA', url: indice });
  expect(prima.output.source).toBe('scheda');

  const apri = await azioneDa(app, { type: 'NAVIGA', url: ARTICOLO });
  expect(apri.needsConfirm || 0).toBe(0);
});
