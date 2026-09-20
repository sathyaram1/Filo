// #553 giro 7 — il freno messo al giro 5 suona sulle letture normali.
//
// Il giro 5 ha collegato al freno anti-esfiltrazione tutto il testo che Filo
// ha LETTO: se un pezzo di quel testo riparte dentro un indirizzo, Filo si
// ferma e chiede conferma. Il titolo di un articolo però sta anche nel suo
// indirizzo, e su un sito di notizie è lungo più della finestra del confronto.
// Così il cammino che la segnalazione chiedeva — leggi una pagina, poi leggi
// (o apri) il pezzo collegato — finisce davanti a un avviso di esfiltrazione
// che non c'entra niente. Un avviso che suona sulle cose normali insegna a
// dire sì, ed è la difesa del giro 5 che si spegne da sola.

import { test, expect } from '../../fixtures/electron.mjs';

const TITOLO = 'Sciopero dei treni di venerdi 12 marzo: tutte le fasce di garanzia regione per regione';
const INDICE = '<!DOCTYPE html><html><head><title>Cronaca</title></head><body><main>'
  + '<h1>Cronaca</h1>'
  + `<p>${TITOLO}</p>`
  + '<p>I convogli si fermeranno dalle 9 alle 17.</p></main></body></html>';

// L'indirizzo del pezzo: il suo percorso è il titolo, come lo scrivono quasi
// tutti i siti di notizie.
const ARTICOLO = 'https://www.esempio.it/cronaca/'
  + 'sciopero-dei-treni-di-venerdi-12-marzo-tutte-le-fasce-di-garanzia-regione-per-regione';

const azioneDa = (app, action, origine) => app.evaluate(
  (_e, [a, o]) => globalThis.SN_HANDLE_MESSAGE({ type: 'filo_run_action', action: a }, { url: o }),
  [action, origine],
);

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

test('dopo aver letto una pagina, leggere il pezzo collegato non chiede conferma', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await openTab('filo://newtab/');
  const CHAT = 'filo://dashboard/dashboard.html';

  await app.evaluate(async (_e, [indice]) => {
    const orig = globalThis.fetch;
    globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
    globalThis.fetch = async () => new Response(indice, {
      status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }, [INDICE]);

  const prima = await azioneDa(app, { type: 'LEGGI_PAGINA', url: 'https://www.esempio.it/cronaca/' }, CHAT);
  expect(String(prima.output.text || '')).toContain('Sciopero dei treni');

  // Il passo che la segnalazione chiede: apri e leggi il risultato promettente.
  const dopo = await azioneDa(app, { type: 'LEGGI_PAGINA', url: ARTICOLO }, CHAT);
  expect(dopo.needsConfirm || 0).toBe(0);
});

test('e nemmeno aprirlo in una scheda', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await openTab('filo://newtab/');
  const CHAT = 'filo://dashboard/dashboard.html';

  await app.evaluate(async (_e, [indice]) => {
    const orig = globalThis.fetch;
    globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
    globalThis.fetch = async () => new Response(indice, {
      status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }, [INDICE]);

  const prima = await azioneDa(app, { type: 'LEGGI_PAGINA', url: 'https://www.esempio.it/cronaca/' }, CHAT);
  expect(String(prima.output.text || '')).toContain('Sciopero dei treni');

  const apri = await azioneDa(app, { type: 'NAVIGA', url: ARTICOLO }, CHAT);
  expect(apri.needsConfirm || 0).toBe(0);
});
