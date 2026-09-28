// Verifica #553 — giro 13, rilievo 2. I pezzi di una riga che a schermo stanno in riquadri affiancati arrivano
// incollati: «7:30» e «19:30» diventano «7:3019:30», la quantità 2 e il prezzo 1,20 diventano «21,20».

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';
const PROSA = 'La nostra pasticceria nasce nel 1962 in una vecchia bottega del centro storico, e da allora serviamo dolci '
  + 'di casa con ingredienti del mercato di ogni mattina, burro fresco e farine macinate a pietra dal mulino qui vicino.';

const leggi = (app, azione) => app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), azione);
async function reteDiProva(app) {
  await app.evaluate(() => {
    globalThis.SN_LETTURA_PAGINE._cache.clear();
    globalThis.SN_LETTURA_PAGINE._dip.scarica = (url, opts) => fetch(url, opts);
  });
}
const primaDeiChiusi = (t) => String(t).split('[Chiuso o nascosto')[0];

// Un sito generato (React, Vue) scrive i pezzi di una riga senza spazi fra un tag e l'altro: a schermo li separa lo stile.
const ORARI = `<!doctype html><html><head><title>Bar Centrale</title></head><body><main><h1>Bar Centrale</h1><p>${PROSA}</p>`
  + '<h2>Orari</h2><div style="display:flex;gap:12px"><span>Lunedì</span><span>7:30</span><span>19:30</span></div>'
  + '<div style="display:flex;gap:12px"><span>Caffè al banco</span><span>2</span><span>1,20 €</span></div></main></body></html>';

test('scheda aperta: gli orari scritti in riquadri affiancati arrivano separati come li vede l\'utente', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await openTab(NEWTAB);
  const url = testServer.html(ORARI);
  await app.evaluate((_e, url) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url, background: true }), url);
  await expect.poll(() => app.windows().some((w) => { try { return w.url() === url; } catch (_) { return false; } }), { timeout: 10_000 }).toBe(true);
  const scheda = app.windows().find((w) => w.url() === url);
  await scheda.waitForLoadState('load');
  console.log('innerText:', JSON.stringify(await scheda.evaluate(() => document.querySelector('main').innerText)));
  await app.evaluate(() => { globalThis.SN_LETTURA_PAGINE._dip.scarica = async () => { throw new Error('niente rete'); }; });
  const r = await leggi(app, { type: 'LEGGI_PAGINA', url });
  console.log('letto:', JSON.stringify(r.output.testo.slice(-120)));
  expect(r.output.fonte).toBe('scheda');
  expect(r.output.testo).not.toContain('7:3019:30');
  expect(r.output.testo).not.toContain('21,20');
});

test('pagina scaricata: gli orari scritti in riquadri affiancati non si incollano in un numero che non esiste', async ({ app, openTab, testServer }) => {
  await openTab(NEWTAB);
  await reteDiProva(app);
  const r = await leggi(app, { type: 'LEGGI_PAGINA', url: testServer.html(ORARI) });
  console.log('letto:', JSON.stringify(r.output.testo.slice(-120)));
  expect(r.output.testo).not.toContain('7:3019:30');
  expect(r.output.testo).not.toContain('21,20');
});
