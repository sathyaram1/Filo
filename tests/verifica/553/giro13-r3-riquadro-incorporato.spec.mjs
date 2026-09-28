// Verifica #553 — giro 13, rilievo 3. Il contenuto che la pagina mostra dentro un riquadro incorporato non arriva,
// e Filo non dice che manca: il modello riceve il solo titolo e conclude che il dato non c'è.

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

const leggi = (app, azione) => app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), azione);
async function reteDiProva(app) {
  await app.evaluate(() => {
    globalThis.SN_LETTURA_PAGINE._cache.clear();
    globalThis.SN_LETTURA_PAGINE._dip.scarica = (url, opts) => fetch(url, opts);
  });
}
const primaDeiChiusi = (t) => String(t).split('[Chiuso o nascosto')[0];

test('pagina scaricata col contenuto in un riquadro incorporato: arriva, o Filo lo dice', async ({ app, openTab, testServer }) => {
  await openTab(NEWTAB);
  await reteDiProva(app);
  const interno = testServer.html('<!doctype html><html><body><h2>Orari degli uffici</h2><p>Anagrafe: dal lunedì al venerdì, 8:30-12:30</p></body></html>');
  const url = testServer.html(`<!doctype html><html><head><title>Comune di Rovigo</title></head><body><h1>Comune di Rovigo</h1><iframe src="${interno}" width="800" height="600"></iframe></body></html>`);
  const r = await leggi(app, { type: 'LEGGI_PAGINA', url });
  const t = JSON.stringify(r.output);
  console.log(t.slice(0, 600));
  expect(/8:30-12:30/.test(t) || new RegExp(interno.replace(/[/.:]/g, '\\$&')).test(t), 'o il testo, o dove trovarlo').toBe(true);
});

test('scheda aperta col contenuto in un riquadro incorporato: arriva, o Filo lo dice', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await openTab(NEWTAB);
  const interno = testServer.html('<!doctype html><html><body><h2>Orari degli uffici</h2><p>Anagrafe: dal lunedì al venerdì, 8:30-12:30</p></body></html>');
  const url = testServer.html(`<!doctype html><html><head><title>Comune di Rovigo</title></head><body><h1>Comune di Rovigo</h1><iframe src="${interno}" width="800" height="600"></iframe></body></html>`);
  await app.evaluate((_e, url) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url, background: true }), url);
  await expect.poll(() => app.windows().some((w) => { try { return w.url() === url; } catch (_) { return false; } }), { timeout: 10_000 }).toBe(true);
  await app.windows().find((w) => w.url() === url).waitForLoadState('load');
  await app.evaluate(() => { globalThis.SN_LETTURA_PAGINE._dip.scarica = async () => { throw new Error('niente rete'); }; });
  const r = await leggi(app, { type: 'LEGGI_PAGINA', url });
  const t = JSON.stringify(r.output);
  console.log(t.slice(0, 600));
  expect(r.output.fonte).toBe('scheda');
  expect(/8:30-12:30/.test(t) || new RegExp(interno.replace(/[/.:]/g, '\\$&')).test(t), 'o il testo, o dove trovarlo').toBe(true);
});
