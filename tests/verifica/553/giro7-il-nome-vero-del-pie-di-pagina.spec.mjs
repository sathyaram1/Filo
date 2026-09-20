// #553 giro 7 — il contorno finisce in coda solo quando il riquadro è scritto
// nudo, e sui siti veri non lo è quasi mai.
//
// Il giro 6 aveva trovato che l'orario di apertura, scritto nel piè di pagina,
// non arrivava mai a Filo («a che ora apre?» è uno dei quattro esempi della
// segnalazione) e la cura ha mandato il contorno in coda invece che nel
// cestino. Vale per `<footer>` e basta: il piè di pagina di un sito fatto col
// programma più diffuso del web si chiama «site-footer», quello di una
// libreria di stili «page-footer», e i siti più vecchi lo chiamano «footer» in
// un riquadro qualunque. In tutti questi casi l'orario è di nuovo perduto.

import { test, expect } from '../../fixtures/electron.mjs';

const leggi = (app, html, url = 'https://example.com/pagina') => app.evaluate(async (_e, [pagina, indirizzo]) => {
  const orig = globalThis.fetch;
  globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
  globalThis.fetch = async () => new Response(pagina, {
    status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  const r = await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url: indirizzo });
  return r.output;
}, [html, url]);

const CORPO = '<h1>Trattoria da Anna</h1><p>Cucina bolognese dal 1974, in centro a Bologna.</p>';
const ORARI = '<h2>Orari</h2><p>Lun-Sab 8:00-19:30, domenica chiuso</p><p>Tel. 051 123456 - Via Roma 4</p>';

const pagina = (pie) => '<!DOCTYPE html><html><head><title>Trattoria da Anna</title></head><body>'
  + `<main>${CORPO}</main>${pie}</body></html>`;

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

test('l\'orario arriva anche dal piè di pagina che si chiama «site-footer»', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, pagina(`<footer id="colophon" class="site-footer">${ORARI}</footer>`));
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('Cucina bolognese');
  expect(String(out.text)).toContain('8:00-19:30');
  expect(String(out.text)).toContain('051 123456');
});

test('e da quello che si chiama «page-footer»', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, pagina(`<footer class="page-footer">${ORARI}</footer>`));
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('8:00-19:30');
});

test('e da un riquadro qualunque chiamato «footer», come sui siti più vecchi', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, pagina(`<div id="footer">${ORARI}</div>`));
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('8:00-19:30');
});

test('lo stesso piè di pagina non deve dipendere da quanto è annidato', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const dentro = await leggi(app, '<!DOCTYPE html><html><head><title>T</title></head><body>'
    + `<div class="wrapper"><main>${CORPO}</main><div class="footer">${ORARI}</div></div></body></html>`);
  const fuori = await leggi(app, '<!DOCTYPE html><html><head><title>T</title></head><body>'
    + `<main>${CORPO}</main><div class="footer">${ORARI}</div></body></html>`);
  expect(String(dentro.text)).toContain('8:00-19:30');
  expect(String(fuori.text)).toContain('8:00-19:30');
});

test('il titolo e la data in un\'intestazione chiamata «header» non spariscono', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, '<!DOCTYPE html><html><head><title>Cronaca</title></head><body>'
    + '<header class="header"><h1>Sciopero dei treni</h1>'
    + '<p>Pubblicato il 12 marzo 2026 alle 14:30 da Anna Bianchi</p></header>'
    + '<div><p>I convogli si fermeranno dalle 9 alle 17.</p></div></body></html>');
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('Sciopero dei treni');
  expect(String(out.text)).toContain('14:30');
  expect(String(out.text)).toContain('Anna Bianchi');
});

test('una riga lunga in cima al piè di pagina non si porta via le righe dopo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const informativa = `<p>${'Informativa sui cookie. '.repeat(200)}</p>`;
  const out = await leggi(app, pagina(`<footer>${informativa}${ORARI}</footer>`));
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('8:00-19:30');
});
