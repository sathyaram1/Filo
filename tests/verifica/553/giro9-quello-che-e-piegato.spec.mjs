// #553 giro 9 — quello che il sito tiene PIEGATO non è quello che nasconde.
//
// Dal quinto giro in poi la lettura scarta quello che la pagina scaricata
// dichiara invisibile, per non farsi dettare la risposta da un'esca. Ma nel
// codice scaricato «invisibile adesso» vuol dire anche «chiuso finché non lo
// apri»: la risposta di una domanda frequente, la scheda del listino non
// attiva, il seguito di «leggi tutto». Sono i posti dove stanno le risposte
// alle domande della segnalazione: «a che ora apre?», «quanto costa?».

import { test, expect } from '../../fixtures/electron.mjs';

const leggi = (app, html, url = 'https://esempio.it/pagina') => app.evaluate(async (_e, [p, u]) => {
  const orig = globalThis.fetch;
  globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
  globalThis.fetch = async () => new Response(p, {
    status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  return (await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url: u })).output;
}, [html, url]);

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

const FAQ = (chiusura) => '<!DOCTYPE html><html><head><title>Trattoria da Gino</title></head><body>'
  + '<main><h1>Trattoria da Gino</h1><p>Cucina casalinga dal 1970.</p>'
  + '<h2>Domande frequenti</h2>'
  + '<div class="accordion-item"><h3 class="accordion-header">'
  + '<button aria-expanded="false" aria-controls="r1">A che ora aprite?</button></h3>'
  + `<div id="r1" class="accordion-collapse collapse" ${chiusura}>`
  + '<div class="accordion-body">Siamo aperti dalle 8:00 alle 19:30, dal lunedi al sabato.</div>'
  + '</div></div></main></body></html>';

test('l\'orario nella domanda frequente chiusa arriva a Filo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, FAQ('style="display:none"'));
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('8:00 alle 19:30');
});

test('e anche quando il pannello chiuso porta l\'attributo che lo dichiara nascosto', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, FAQ('hidden'));
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('8:00 alle 19:30');
});

test('e anche col modo con cui le librerie ARIA chiudono un pannello', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, FAQ('aria-hidden="true"'));
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('8:00 alle 19:30');
});

test('il prezzo annuale della scheda non attiva di un listino arriva a Filo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, '<!DOCTYPE html><html><head><title>Prezzi</title></head><body><main>'
    + '<h1>Prezzi</h1><div role="tablist"><button aria-selected="true">Mensile</button>'
    + '<button aria-selected="false">Annuale</button></div>'
    + '<div role="tabpanel"><p>Mensile 9,99 euro al mese</p></div>'
    + '<div role="tabpanel" style="display:none"><p>Annuale 99,00 euro all\'anno</p></div>'
    + '</main></body></html>');
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('99,00');
});

test('il seguito di «leggi tutto» arriva a Filo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, '<!DOCTYPE html><html><head><title>Bollo auto</title></head><body><main>'
    + '<h1>Quanto costa il bollo</h1><p>Dipende dalla potenza del veicolo.</p>'
    + '<button>Leggi tutto</button>'
    + '<div class="full-text" style="display:none"><p>Per una utilitaria si pagano 128,40 euro all\'anno.</p></div>'
    + '</main></body></html>');
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('128,40');
});
