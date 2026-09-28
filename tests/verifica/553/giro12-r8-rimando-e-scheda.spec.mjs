// Verifica #553 — giro 12, rilievo 8. Una pagina che si costruisce in JavaScript e rimanda altrove: Filo dice al
// modello di aprirla in una scheda e rileggerla con lo stesso indirizzo, ma la scheda sta sull'indirizzo di arrivo
// e la rilettura la riscarica, vuota come prima.

import { test, expect } from '../../fixtures/electron.mjs';

test('aperta in una scheda come chiede Filo, la pagina che rimanda si rilegge dalla scheda', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const arrivo = testServer.html(`<!doctype html><html><head><title>Listino</title></head><body><div id="root"></div>
<script>document.getElementById('root').innerHTML = '<main><h1>Listino</h1><p>Il piano Pro costa 17,40 euro al mese, fatturato ogni anno; il piano Base costa 6,90 euro al mese e comprende tre utenti.</p></main>';</script></body></html>`);
  const partenza = testServer.html(`<!doctype html><html><head><title>Listino</title><script>location.replace(${JSON.stringify(arrivo)})</script></head><body></body></html>`);
  await app.evaluate(() => { globalThis.SN_LETTURA_PAGINE._cache.clear(); globalThis.SN_LETTURA_PAGINE._dip.scarica = (u, o) => fetch(u, o); });
  const primo = await app.evaluate((_e, url) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url }), partenza);
  expect(primo.output.testo).toBe('');
  // Il passo che l'esito della lettura consiglia al modello: aprila con NAVIGA in sottofondo e rileggila.
  await app.evaluate((_e, url) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url, background: true }), partenza);
  await expect.poll(() => app.windows().some((w) => { try { return w.url() === arrivo; } catch (_) { return false; } }), { timeout: 10_000 }).toBe(true);
  const scheda = app.windows().find((w) => w.url() === arrivo);
  await scheda.waitForFunction(() => document.body.innerText.includes('17,40'), null, { timeout: 10_000 });
  const secondo = await app.evaluate((_e, url) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url }), partenza);
  expect(String(secondo.output.testo)).toContain('17,40');
});
