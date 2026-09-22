// #553 giro 10 — i due nomi rimasti nel cestino, già scritti al giro 9.
//
// Il giro 9 aveva nominato «related» e «recommended»: è il riquadro dove un
// negozio online mette le alternative con il loro prezzo. La cura ha spostato
// in coda «subscribe» e ha lasciato questi due nel cestino, con tutto il loro
// contenuto. La regola che vale per il piè di pagina vale anche qui: in coda,
// non nel cestino.

import { test, expect } from '../../fixtures/electron.mjs';

const NOMI = ['related', 'recommended'];

const pagina = (nome) => '<!DOCTYPE html><html><head><title>Scarpe</title></head><body>'
  + '<main><h1>Scarpe rosse</h1><p>Prezzo: 79,00 euro</p></main>'
  + `<section class="${nome}"><h2>Alternative</h2><p>Scarpe blu: 49,00 euro</p></section>`
  + '</body></html>';

const leggi = (app, html, url = 'https://example.com/scarpe') => app.evaluate(async (_e, [p, u]) => {
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

for (const nome of NOMI) {
  test(`il prezzo dell'alternativa nel riquadro «${nome}» arriva a Filo`, async ({ app, openTab }) => {
    test.setTimeout(60_000);
    await openTab('filo://newtab/');
    const out = await leggi(app, pagina(nome));
    expect(out.ok).toBe(true);
    expect(String(out.text)).toContain('79,00');
    expect(String(out.text)).toContain('49,00');
  });
}
