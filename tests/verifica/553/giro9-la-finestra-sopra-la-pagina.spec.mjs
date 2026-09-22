// #553 giro 9 — col banner dei cookie aperto, a Filo arriva il banner e non la
// pagina.
//
// Ogni libreria di consenso, quando apre la sua finestra, marca il resto della
// pagina come nascosto agli assistivi: è il modo standard di dire «adesso si
// parla solo qui». Per la lettura quel resto è tutto il contenuto del sito.
// Va a finire bene solo se la pagina dichiara una zona principale: due pagine
// identiche per l'utente danno due risposte diverse.

import { test, expect } from '../../fixtures/electron.mjs';

const leggi = (app, html, url = 'https://esempio.it/pagina') => app.evaluate(async (_e, [p, u]) => {
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

const CORPO = '<h1>Trattoria da Gino</h1><p>Cucina casalinga dal 1970.</p>'
  + '<p>Orari: lun-sab 8:00-19:30</p><p>Margherita 6,50 euro</p>';

const CONSENSO = '<div role="dialog" aria-modal="true" class="cookie-consent">'
  + '<p>Questo sito usa i cookie per migliorare la tua esperienza.</p>'
  + '<button>Accetto tutto</button></div>';

const pagina = (dentro) => '<!DOCTYPE html><html><head><title>Trattoria da Gino</title></head><body>'
  + `<div id="root" aria-hidden="true">${dentro}</div>${CONSENSO}</body></html>`;

test('con la finestra del consenso aperta l\'orario arriva lo stesso', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, pagina(CORPO));
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('8:00-19:30');
});

test('e Filo non consegna il testo del banner al posto della pagina', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, pagina(CORPO));
  expect(out.ok).toBe(true);
  expect(String(out.text)).not.toMatch(/Accetto tutto/);
});

test('la stessa pagina con una zona principale dichiarata risponde giusto', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, pagina(`<main>${CORPO}</main>`));
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('8:00-19:30');
});
