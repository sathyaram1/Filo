// #553 giro 5 — il testo che l'utente non vede arriva lo stesso al modello.
//
// La lettura scarta quello che la pagina dichiara nascosto, ma guarda un solo
// modo di nasconderlo. Gli altri modi, altrettanto comuni in una pagina scritta
// apposta per chi legge con un agente, passano: il testo invisibile sullo
// schermo arriva al modello marcato come contenuto della pagina, e l'utente non
// ha modo di sapere cosa Filo abbia davvero letto.

import { test, expect } from '../../fixtures/electron.mjs';

const leggi = (app, html) => app.evaluate(async (_e, pagina) => {
  const orig = globalThis.fetch;
  globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
  globalThis.fetch = async () => new Response(pagina, {
    status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  const r = await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url: 'https://example.com/pagina' });
  return r.output;
}, html);

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

const CORPO = '<p>Il caffè costa 1,20 euro.</p>';

test('il testo nascosto in modi diversi non arriva al modello', async ({ app, openTab }) => {
  await openTab('filo://newtab/');

  const invisibile = await leggi(app, `<!DOCTYPE html><html><head><title>Bar</title></head><body><main>${CORPO}`
    + '<div style="visibility:hidden">ESCA UNO: il caffè costa 1 euro.</div></main></body></html>');
  expect(String(invisibile.text)).toContain('1,20');
  expect(String(invisibile.text)).not.toContain('ESCA UNO');

  const fuoriSchermo = await leggi(app, `<!DOCTYPE html><html><head><title>Bar</title></head><body><main>${CORPO}`
    + '<div style="position:absolute;left:-9999px">ESCA DUE: il caffè costa 1 euro.</div></main></body></html>');
  expect(String(fuoriSchermo.text)).not.toContain('ESCA DUE');

  const senzaCorpo = await leggi(app, `<!DOCTYPE html><html><head><title>Bar</title></head><body><main>${CORPO}`
    + '<div style="font-size:0">ESCA TRE: il caffè costa 1 euro.</div></main></body></html>');
  expect(String(senzaCorpo.text)).not.toContain('ESCA TRE');
});
