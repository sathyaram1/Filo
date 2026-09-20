// #553 giro 4 — di una pagina divisa in più pezzi marcati come articolo ne
// arriva SOLO IL PRIMO, e il dato che l'utente cerca sta quasi sempre in uno
// degli altri: la risposta sotto la domanda, il prezzo dell'altra scheda.
//
// Il giro 3 aveva trovato la stessa cosa sui blocchi chiamati «commenti» e
// quella porta è chiusa; questa, che è la forma con cui i siti di discussione
// impaginano davvero, resta aperta quando nella pagina non c'è <main>.

import { test, expect } from '../../fixtures/electron.mjs';

async function leggi(app, html) {
  return app.evaluate(async (_e, pagina) => {
    const orig = globalThis.fetch;
    globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
    globalThis.fetch = async () => new Response(pagina, {
      status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
    });
    const r = await globalThis.SN_EXECUTE_FILO_ACTION({
      type: 'LEGGI_PAGINA', url: 'https://example.com/discussione',
    });
    return r.output;
  }, html);
}

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

test('le risposte di una discussione arrivano anche quando ogni messaggio è un articolo', async ({ app, openTab }) => {
  await openTab('filo://newtab/');
  const out = await leggi(app, '<!DOCTYPE html><html><head><title>Quanto costa il bollo</title></head><body><div class="wrap">'
    + '<article class="post"><h1>Quanto costa il bollo?</h1><p>Ho una utilitaria del 2015 e non trovo il dato.</p></article>'
    + '<article class="post"><p>Per quella cilindrata sono 128,40 euro all\'anno.</p></article>'
    + '</div></body></html>');

  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('Ho una utilitaria');
  expect(String(out.text)).toContain('128,40');
});

test('la risposta fuori dall\'articolo non sparisce', async ({ app, openTab }) => {
  await openTab('filo://newtab/');
  const out = await leggi(app, '<!DOCTYPE html><html><head><title>Bollo</title></head><body><div class="wrap">'
    + '<article><h1>Quanto costa il bollo?</h1><p>Ho una utilitaria del 2015 e non trovo il dato.</p></article>'
    + '<div class="risposte"><h2>2 risposte</h2><p>Per quella cilindrata sono 128,40 euro all\'anno.</p></div>'
    + '</div></body></html>');

  expect(String(out.text)).toContain('128,40');
});

test('di un listino diviso in schede arrivano tutte le schede', async ({ app, openTab }) => {
  await openTab('filo://newtab/');
  const out = await leggi(app, '<!DOCTYPE html><html><head><title>Listino</title></head><body>'
    + '<article class="tab"><h2>Mensile</h2><p>19,90 euro al mese per il piano base.</p></article>'
    + '<article class="tab"><h2>Annuale</h2><p>199,00 euro all\'anno.</p></article>'
    + '</body></html>');

  expect(String(out.text)).toContain('19,90');
  expect(String(out.text)).toContain('199,00');
});
