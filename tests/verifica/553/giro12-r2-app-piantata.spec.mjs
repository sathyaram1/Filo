// Verifica #553 — giro 12, rilievo 2. Una pagina di poche centinaia di KB tiene ferma tutta l'app mentre Filo la
// legge: il tempo della lettura cresce col quadrato della lunghezza di una riga fatta di tanti pezzetti.
// Il fermo si misura dentro il processo principale, quello che tiene tutte le finestre: il buco più lungo fra due
// battiti di un orologio da 50 ms.

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

async function fermoDurante(app, url) {
  return app.evaluate(async (_e, url) => {
    globalThis.SN_LETTURA_PAGINE._cache.clear();
    globalThis.SN_LETTURA_PAGINE._dip.scarica = (u, o) => fetch(u, o);
    let ultimo = Date.now();
    let peggiore = 0;
    const orologio = setInterval(() => { const t = Date.now(); peggiore = Math.max(peggiore, t - ultimo); ultimo = t; }, 50);
    const t0 = Date.now();
    const r = await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url });
    const durata = Date.now() - t0;
    peggiore = Math.max(peggiore, Date.now() - ultimo);
    clearInterval(orologio);
    return { peggiore, durata, letto: String((r.output && r.output.testo) || '').includes('1,20') };
  }, url);
}

test('mentre Filo legge una pagina da 240 KB l\'app continua a rispondere', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  await openTab(NEWTAB);
  const url = testServer.html(`<!doctype html><html><head><title>Bar Centrale</title></head><body><main><h1>Bar Centrale</h1>
<p>Il caffè costa 1,20 euro.</p></main>${'<a'.repeat(120000)}</body></html>`);
  const m = await fermoDurante(app, url);
  console.log(`processo principale fermo per ${m.peggiore} ms, lettura in ${m.durata} ms`);
  expect(m.letto).toBe(true);
  expect(m.peggiore).toBeLessThan(2000);
});

test('stessa cosa con una riga di 150 mila pezzetti di testo normale', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  await openTab(NEWTAB);
  const url = testServer.html(`<!doctype html><html><head><title>Registro</title></head><body><main><h1>Registro</h1>
<p>Il caffè costa 1,20 euro.</p><p>${'<span>ok </span>'.repeat(150000)}</p></main></body></html>`);
  const m = await fermoDurante(app, url);
  console.log(`processo principale fermo per ${m.peggiore} ms, lettura in ${m.durata} ms`);
  expect(m.letto).toBe(true);
  expect(m.peggiore).toBeLessThan(2000);
});
