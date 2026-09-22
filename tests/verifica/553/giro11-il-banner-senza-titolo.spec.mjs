// #553 giro 11 — col banner del consenso aperto arriva ancora il banner.
//
// La cura del giro 10 fa tornare il contenuto solo quando il titolo grande
// della pagina manca dal testo. Due pagine comunissime non danno quella prova:
// quella che il titolo grande non ce l'ha, e quella in cui il titolo grande è
// del banner. Lì al modello arriva il solo testo del consenso, consegnato come
// se fosse il contenuto del sito.

import { test, expect } from '../../fixtures/electron.mjs';

const CONTENUTO = '<p>Siamo aperti dalle 8:00 alle 19:30, dal lunedi al sabato.</p>'
  + '<p>Il caffe costa 1,20 euro.</p>';

const FORME = {
  'su una pagina senza titolo grande':
    '<div class="cmp"><p>Questo sito usa i cookie</p><button>Accetto tutto</button></div>'
    + `<div id="app" aria-hidden="true"><h2>Trattoria da Gino</h2>${CONTENUTO}</div>`,
  'quando il titolo grande e del banner':
    '<div class="cmp"><h1>Rispettiamo la tua privacy</h1><p>Questo sito usa i cookie</p>'
    + '<button>Accetto tutto</button></div>'
    + `<div id="app" aria-hidden="true"><h1>Trattoria da Gino</h1>${CONTENUTO}</div>`,
};

const pagina = (corpo) => '<!DOCTYPE html><html><head><title>Trattoria da Gino</title></head>'
  + `<body>${corpo}</body></html>`;

const leggi = (app, html, url = 'https://example.com/trattoria') => app.evaluate(async (_e, [p, u]) => {
  const orig = globalThis.fetch;
  globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
  globalThis.fetch = async () => new Response(p, {
    status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  return (await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url: u })).output;
}, [html, url]);

const leggiDaScheda = (app, url) => app.evaluate(
  async (_e, u) => (await globalThis.SN_EXECUTE_FILO_ACTION(
    { type: 'LEGGI_PAGINA', url: u },
    { sender: { url: 'filo://dashboard/dashboard.html' } },
  )).output,
  url,
);

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

for (const [come, corpo] of Object.entries(FORME)) {
  test(`col banner ${come} arriva la pagina, non il banner`, async ({ app, openTab }) => {
    test.setTimeout(60_000);
    await openTab('filo://newtab/');
    const out = await leggi(app, pagina(corpo));
    expect(out.ok).toBe(true);
    expect(String(out.text)).toContain('19:30');
    expect(String(out.text)).toContain('1,20');
  });
}

test('e anche dalla scheda che l\'utente ha gia aperta', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const url = testServer.html(pagina(FORME['su una pagina senza titolo grande']));
  await openTab(url);
  const out = await leggiDaScheda(app, url);
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('19:30');
});
