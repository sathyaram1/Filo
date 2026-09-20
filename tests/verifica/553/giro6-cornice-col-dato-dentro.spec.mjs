// #553 giro 6 — la cornice del sito si butta via dal NOME del riquadro, e
// quei nomi stanno anche addosso al contenuto.
//
// «A che ora apre?» è uno dei quattro esempi della segnalazione, e su un sito
// di un locale l'orario sta nel piè di pagina insieme al telefono e
// all'indirizzo: lì Filo non guarda. Sulla stessa strada un riquadro chiamato
// «promo» porta via il prezzo scontato lasciando quello di listino — non un
// dato mancante, un dato SBAGLIATO — e uno chiamato «banner» porta via il
// titolo del pezzo con la sua data.

import { test, expect } from '../../fixtures/electron.mjs';

const leggi = (app, html, url = 'https://example.com/pagina') => app.evaluate(async (_e, [pagina, indirizzo]) => {
  const orig = globalThis.fetch;
  globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
  globalThis.fetch = async () => new Response(pagina, {
    status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  const r = await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url: indirizzo });
  return r.output;
}, [html, url]);

const leggiDaScheda = (app, url) => app.evaluate(
  async (_e, u) => (await globalThis.SN_EXECUTE_FILO_ACTION(
    { type: 'LEGGI_PAGINA', url: u },
    { sender: { url: 'filo://dashboard/dashboard.html' } },
  )).output,
  url,
);

const TRATTORIA = '<!DOCTYPE html><html><head><title>Trattoria da Anna</title></head><body>'
  + '<main><h1>Trattoria da Anna</h1><p>Cucina bolognese dal 1974.</p></main>'
  + '<footer><h2>Orari</h2><p>Lun-Sab 8:00-19:30, domenica chiuso</p>'
  + '<p>Tel. 051 123456 - Via Roma 4, Bologna</p></footer></body></html>';

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

test('l\'orario di apertura scritto nel piè di pagina arriva a Filo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, TRATTORIA);
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('Cucina bolognese');
  expect(String(out.text)).toContain('8:00-19:30');
  expect(String(out.text)).toContain('051 123456');
});

test('lo stesso piè di pagina arriva anche dalla scheda già aperta', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const url = testServer.html(TRATTORIA);
  await openTab(url);
  const out = await leggiDaScheda(app, url);
  expect(out.ok).toBe(true);
  expect(out.source).toBe('scheda');
  expect(String(out.text)).toContain('8:00-19:30');
});

test('il prezzo in promozione non sparisce lasciando solo quello di listino', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, '<!DOCTYPE html><html><head><title>Abbonamento</title></head><body><main>'
    + '<h1>Abbonamento</h1><section class="promo"><p>In offerta fino a domenica: 4,99 euro al mese</p></section>'
    + '<p>Prezzo di listino: 9,99 euro al mese</p></main></body></html>');
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('9,99');
  expect(String(out.text)).toContain('4,99');
});

test('il titolo e la data dentro un riquadro chiamato «banner» non spariscono', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, '<!DOCTYPE html><html><head><title>Cronaca</title></head><body><main>'
    + '<div class="banner"><h1>Sciopero dei treni</h1><p>Pubblicato il 12 marzo 2026 alle 14:30 da Anna Bianchi</p></div>'
    + '<p>I convogli si fermeranno dalle 9 alle 17.</p></main></body></html>');
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('Sciopero dei treni');
  expect(String(out.text)).toContain('14:30');
  expect(String(out.text)).toContain('Anna Bianchi');
});
