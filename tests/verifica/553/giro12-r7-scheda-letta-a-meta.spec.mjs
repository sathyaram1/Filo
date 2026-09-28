// Verifica #553 — giro 12, rilievo 7. Della pagina grande già aperta in una scheda Filo legge la prima parte e la
// consegna come se fosse tutta: sulla pagina scaricata lo stesso taglio viene dichiarato, qui no.

import { test, expect } from '../../fixtures/electron.mjs';

test('una tabella lunga aperta in una scheda arriva intera, o Filo dice dove si è fermato', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await openTab('filo://newtab/');
  const righe = Array.from({ length: 20000 }, (_, i) => `<tr><td>${i + 1}</td><td>a</td><td>b</td><td>c</td><td>d</td><td>e</td><td>f</td><td>g</td></tr>`).join('');
  const url = testServer.html(`<!doctype html><html><head><title>Registro spedizioni</title></head><body><main><h1>Registro</h1>
<table>${righe}<tr><td>ULTIMA_RIGA</td><td>consegnata il 27 settembre</td></tr></table></main></body></html>`);
  await app.evaluate((_e, url) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url, background: true }), url);
  await expect.poll(() => app.windows().some((w) => { try { return w.url() === url; } catch (_) { return false; } }), { timeout: 15_000 }).toBe(true);
  await app.windows().find((w) => w.url() === url).waitForLoadState('load');
  await app.evaluate(() => { globalThis.SN_LETTURA_PAGINE._dip.scarica = async () => { throw new Error('niente rete'); }; });
  // Si legge a pezzi col seguito, come farebbe il modello, finché la pagina dice di essere finita.
  const letto = await app.evaluate(async (_e, url) => {
    let da = 0; let tutto = ''; let giri = 0; let ultimo = null;
    do {
      ultimo = (await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url, da })).output;
      tutto += ultimo.testo; da = ultimo.fino; giri++;
    } while (ultimo.troncata && giri < 200);
    return { tutto, fonte: ultimo.fonte, avviso: ultimo.scaricataInParte === true || ultimo.lettaInParte === true, righe: (tutto.match(/\n\d+ \|/g) || []).length };
  }, url);
  console.log(`righe arrivate: ${letto.righe} su 20000`);
  expect(letto.fonte).toBe('scheda');
  const intera = letto.tutto.includes('ULTIMA_RIGA');
  expect(intera || !!letto.avviso, 'o la pagina arriva intera, o l\'esito dice che è arrivata in parte').toBe(true);
});
