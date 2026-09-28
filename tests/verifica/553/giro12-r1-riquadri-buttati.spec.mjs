// Verifica #553 — giro 12, rilievo 1. Il dato che l'utente chiede sta in un riquadro che la lettura butta via
// intero per il nome o il marcatore che gli dà il sito: piè di pagina, listino chiamato «menu», promo, prezzo
// scritto per gli occhi e per i lettori di schermo, pannello delle domande frequenti. Vale su tutte e due le strade.

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';
const PROSA = 'La nostra trattoria nasce nel 1962 in una vecchia osteria del centro storico, e da allora serviamo la '
  + 'cucina di casa con ingredienti del mercato di ogni mattina, pasta tirata a mano e dolci fatti da noi.';

async function reteDiProva(app) {
  await app.evaluate(() => {
    globalThis.SN_LETTURA_PAGINE._cache.clear();
    globalThis.SN_LETTURA_PAGINE._dip.scarica = (url, opts) => fetch(url, opts);
  });
}
const leggi = (app, azione) => app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), azione);

const PAGINE = {
  // Il piè di pagina come lo scrive WordPress da solo: è dove una trattoria mette gli orari.
  piede: { dato: 'lun-sab 8:00-19:30', html: `<!doctype html><html><head><title>Trattoria da Gino</title></head><body><div id="page">
<div id="content"><h1>Trattoria da Gino</h1><p>${PROSA}</p></div>
<footer id="colophon" class="site-footer"><p>Orari: lun-sab 8:00-19:30</p><p>Tel. 051 123456, Via Roma 4</p></footer></div></body></html>` },
  // Il sito di una pizzeria è una pagina sola, e il listino sta nel riquadro a cui porta la voce «Menu».
  listino: { dato: 'Margherita 6,50', html: `<!doctype html><html><head><title>Pizzeria Bella</title></head><body>
<h1>Pizzeria Bella</h1><p>${PROSA}</p><section id="menu"><h2>Il menu</h2><p>Margherita 6,50 euro</p><p>Caffè 1,20 euro</p></section></body></html>` },
  promo: { dato: '4,99 euro al mese', html: `<!doctype html><html><head><title>Offerta</title></head><body><h1>Abbonamento</h1>
<p>${PROSA}</p><div class="promo">In offerta fino a domenica: 4,99 euro al mese</div><p>Prezzo di listino: 9,99</p></body></html>` },
  // Il prezzo disegnato per gli occhi (nascosto ai lettori di schermo) e ripetuto per i lettori di schermo (nascosto agli occhi).
  prezzo: { dato: '129', html: `<!doctype html><html><head><title>Cuffie Z</title></head><body><h1>Cuffie Z</h1><p>${PROSA}</p>
<p>Prezzo: <span aria-hidden="true">129,90 €</span><span class="visually-hidden">129 euro e 90 centesimi</span></p></body></html>` },
  faq: { dato: 'dalle 8:00 alle 19:30', html: `<!doctype html><html><head><title>Domande frequenti</title></head><body><h1>Domande</h1>
<p>${PROSA}</p><button aria-expanded="false" aria-controls="r1">A che ora aprite?</button>
<div id="r1" hidden><p>Siamo aperti dalle 8:00 alle 19:30</p></div></body></html>` },
};

for (const [nome, { dato, html }] of Object.entries(PAGINE)) {
  test(`pagina scaricata, ${nome}: il dato che l'utente vede arriva a Filo`, async ({ app, openTab, testServer }) => {
    await openTab(NEWTAB);
    await reteDiProva(app);
    const r = await leggi(app, { type: 'LEGGI_PAGINA', url: testServer.html(html) });
    expect(r.executed).toBe(true);
    expect(String(r.output.testo)).toContain(dato);
  });
}

test('scheda già aperta: il prezzo che l\'utente ha davanti arriva a Filo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await openTab(NEWTAB);
  const url = testServer.html(PAGINE.prezzo.html);
  await app.evaluate((_e, url) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url, background: true }), url);
  await expect.poll(() => app.windows().some((w) => { try { return w.url() === url; } catch (_) { return false; } }), { timeout: 10_000 }).toBe(true);
  const scheda = app.windows().find((w) => w.url() === url);
  await scheda.waitForLoadState('load');
  expect(await scheda.evaluate(() => document.body.innerText)).toContain('129,90');
  await app.evaluate(() => { globalThis.SN_LETTURA_PAGINE._dip.scarica = async () => { throw new Error('niente rete'); }; });
  const r = await leggi(app, { type: 'LEGGI_PAGINA', url });
  expect(r.output.fonte).toBe('scheda');
  expect(String(r.output.testo)).toContain('129');
});
