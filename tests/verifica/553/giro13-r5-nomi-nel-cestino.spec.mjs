// Verifica #553 — giro 13, rilievo 5. Il nome del riquadro manda ancora nel cestino il listino: la sezione
// «cookies» di una pasticceria, l'elenco di piatti fatto di link chiamato «menu».

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';
const PROSA = 'La nostra pasticceria nasce nel 1962 in una vecchia bottega del centro storico, e da allora serviamo dolci '
  + 'di casa con ingredienti del mercato di ogni mattina, burro fresco e farine macinate a pietra dal mulino qui vicino.';

const leggi = (app, azione) => app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), azione);
async function reteDiProva(app) {
  await app.evaluate(() => {
    globalThis.SN_LETTURA_PAGINE._cache.clear();
    globalThis.SN_LETTURA_PAGINE._dip.scarica = (url, opts) => fetch(url, opts);
  });
}
const primaDeiChiusi = (t) => String(t).split('[Chiuso o nascosto')[0];

test('pagina scaricata: il listino della pasticceria nel riquadro «cookies» arriva', async ({ app, openTab, testServer }) => {
  await openTab(NEWTAB);
  await reteDiProva(app);
  const url = testServer.html(`<!doctype html><html><head><title>Pasticceria Dolce</title></head><body><h1>Pasticceria Dolce</h1><p>${PROSA}</p>
<section id="cookies"><h2>I nostri cookies</h2><p>Cookie al burro 2,50 euro</p><p>Cookie al cioccolato 2,80 euro</p></section></body></html>`);
  const r = await leggi(app, { type: 'LEGGI_PAGINA', url });
  expect(String(r.output.testo)).toContain('2,50');
});

test('pagina scaricata: il listino fatto di link in un elenco chiamato «menu» arriva', async ({ app, openTab, testServer }) => {
  await openTab(NEWTAB);
  await reteDiProva(app);
  const url = testServer.html(`<!doctype html><html><head><title>Pizzeria Bella</title></head><body><main><h1>Pizzeria Bella</h1><p>${PROSA}</p>
<ul class="menu"><li><a href="/p/margherita">Margherita 6,50 euro</a></li><li><a href="/p/diavola">Diavola 8,00 euro</a></li></ul></main></body></html>`);
  const r = await leggi(app, { type: 'LEGGI_PAGINA', url });
  expect(String(r.output.testo)).toContain('6,50');
});
