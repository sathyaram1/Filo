// Verifica #553 — giro 12, rilievo 10. La codifica dichiarata dentro la pagina dopo i primi 4 KB dell'intestazione
// non viene vista: accenti ed euro arrivano al modello come rombi col punto interrogativo.

import { test, expect } from '../../fixtures/electron.mjs';

test('la codifica dichiarata dopo un\'intestazione lunga vale lo stesso', async ({ app, openTab }) => {
  await openTab('filo://newtab/');
  const r = await app.evaluate(async () => {
    globalThis.SN_LETTURA_PAGINE._cache.clear();
    const testa = `<link rel="stylesheet" href="/css/${'x'.repeat(60)}.css">\n`.repeat(70);
    const html = `<html><head>${testa}<meta charset="iso-8859-1"><title>Trattoria</title></head><body><main><p>Il caff\xe8 costa 1,20 \x80.</p></main></body></html>`;
    globalThis.SN_LETTURA_PAGINE._dip.scarica = async () => new Response(Buffer.from(html, 'latin1'), { headers: { 'content-type': 'text/html' } });
    return globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url: 'https://trattoria.example/' });
  });
  expect(String(r.output.testo)).toContain('Il caffè costa 1,20 €');
});
