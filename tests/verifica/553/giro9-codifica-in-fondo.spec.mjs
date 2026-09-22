// #553 giro 9 — la codifica dichiarata dopo un'intestazione lunga non si vede.
//
// Il sesto giro ha chiuso la porta dei siti che dichiarano la codifica dentro
// la pagina invece che nella risposta. Filo però la cerca solo nei primi
// quattromila caratteri: un sito vecchio che prima della dichiarazione mette
// una fila di collegamenti ai fogli di stile la supera, e il prezzo torna al
// modello coi caratteri rotti.

import { test, expect } from '../../fixtures/electron.mjs';

const IMBOTTITURA = '<link rel="preload" as="style" href="/assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.css">\n'.repeat(70);

const leggiLatino = (app, html, url = 'https://trattoria.it/') => app.evaluate(async (_e, [p, u]) => {
  const orig = globalThis.fetch;
  globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
  const byte = new Uint8Array(p.length);
  for (let i = 0; i < p.length; i++) byte[i] = p.charCodeAt(i) & 0xff;
  globalThis.fetch = async () => new Response(byte, {
    status: 200, headers: { 'content-type': 'text/html' },
  });
  return (await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url: u })).output;
}, [html, url]);

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

const pagina = (prima, dopo) => '<!DOCTYPE html><html><head>'
  + prima + '<meta charset="iso-8859-1">' + dopo
  + '<title>Trattoria</title></head><body><main>'
  + '<h1>Trattoria da Gino</h1><p>Il caff\xE8 costa 1,20 \x80</p></main></body></html>';

test('gli accenti arrivano anche se la codifica è dichiarata dopo una lunga intestazione', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggiLatino(app, pagina(IMBOTTITURA, ''));
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('caffè');
  expect(String(out.text)).toContain('1,20 €');
});

test('con la dichiarazione in cima invece funziona già', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggiLatino(app, pagina('', IMBOTTITURA));
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('caffè');
  expect(String(out.text)).toContain('1,20 €');
});
