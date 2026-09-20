// #553 giro 6 — dopo un rimando, il testo arriva da un altro sito e Filo
// continua a chiamarlo col nome dell'indirizzo chiesto.
//
// Accorciatori, aggregatori e qualunque 301 passano di lì: l'utente vede il
// sito sbagliato nella riga della chat e sotto il puntatore, e il modello cita
// la fonte sbagliata. Il nome del sito davanti al titolo era proprio la difesa
// messa in un giro passato, perché il titolo se lo scrive chi possiede la
// pagina: se anche il nome del sito lo sceglie lei, la difesa non tiene.

import { test, expect } from '../../fixtures/electron.mjs';

test('dopo un rimando Filo dice da quale sito ha letto davvero', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await app.evaluate(async () => {
    const orig = globalThis.fetch;
    globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
    globalThis.fetch = async (u) => (String(u).includes('example.com')
      ? new Response('', { status: 302, headers: { location: 'https://example.org/vero' } })
      : new Response('<html><head><title>Pagina vera</title></head><body><main><p>Il prezzo è 42 euro</p></main></body></html>',
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }));
    const r = await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url: 'https://example.com/abc' });
    return r.output;
  });
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('42 euro');
  // L'indirizzo che torna, e che finisce nella riga della chat, è quello da cui
  // il testo viene DAVVERO.
  expect(String(out.pageRead)).toContain('example.org');
});
