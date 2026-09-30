// Verifica #553, giro 14: «rileggi, è cambiata» deve portare la pagina com'è adesso, non la copia di qualche minuto fa.

import { test, expect } from '../../fixtures/electron.mjs';

test('una pagina riletta dopo un paio di minuti arriva com\'è adesso', async ({ app, openTab }) => {
  await openTab('filo://newtab/');
  await app.evaluate(() => {
    globalThis.__versione = 1;
    globalThis.SN_LETTURA_PAGINE._cache.clear();
    globalThis.SN_LETTURA_PAGINE._dip.scarica = async () => new Response(
      `<!doctype html><html><head><title>Diretta</title></head><body><main><h1>Diretta del consiglio comunale</h1>
<p>Aggiornamento numero ${globalThis.__versione}: la seduta è in corso e la votazione sul bilancio non è ancora iniziata.</p></main></body></html>`,
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  });
  const url = 'https://notizie.example/diretta-consiglio';
  const prima = await app.evaluate((_e, url) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url }), url);
  expect(String(prima.output.testo)).toContain('Aggiornamento numero 1');
  // Passano due minuti e la pagina cambia: l'orologio si sposta, la rete no.
  await app.evaluate(() => {
    globalThis.__versione = 2;
    const vero = Date.now;
    const salto = 2 * 60 * 1000;
    Date.now = () => vero() + salto;
  });
  const dopo = await app.evaluate((_e, url) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url }), url);
  expect(String(dopo.output.testo)).toContain('Aggiornamento numero 2');
});
