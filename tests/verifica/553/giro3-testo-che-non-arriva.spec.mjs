// #553 giro 3 — pezzi di pagina che non arrivano mai al modello, o arrivano
// storpiati.
//
// La segnalazione chiedeva il dato che sta DENTRO la pagina. Qui il dato c'è,
// la pagina si legge, ma quel pezzo lì viene buttato via (le risposte di una
// discussione) oppure consegnato rotto (i caratteri scritti come entità, il
// codice che sbuca fra il testo).

import { test, expect } from '../../fixtures/electron.mjs';

async function leggi(app, html) {
  return app.evaluate(async (_e, pagina) => {
    const orig = globalThis.fetch;
    globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
    globalThis.fetch = async () => new Response(pagina, {
      status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
    });
    const r = await globalThis.SN_EXECUTE_FILO_ACTION({
      type: 'LEGGI_PAGINA', url: 'https://example.com/pagina',
    });
    return r.output;
  }, html);
}

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

test('la risposta che sta nella discussione sotto l\'articolo arriva a Filo', async ({ app, openTab }) => {
  await openTab('filo://newtab/');
  const out = await leggi(app, '<!DOCTYPE html><html><head><title>Quanto costa il bollo</title></head><body>'
    + '<main><article><h1>Quanto costa il bollo?</h1><p>Qualcuno lo sa?</p></article>'
    + '<section id="comments"><h2>3 risposte</h2>'
    + '<div class="comment"><p>Per quella cilindrata sono 128,40 euro all\'anno.</p></div>'
    + '</section></main></body></html>');

  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('Qualcuno lo sa?');
  // È la risposta alla domanda dell\'utente, ed è l\'unico posto dove il numero
  // esiste: senza, Filo dice che non c'è scritto.
  expect(String(out.text)).toContain('128,40');
});

test('i caratteri scritti come entità arrivano come caratteri', async ({ app, openTab }) => {
  await openTab('filo://newtab/');
  const out = await leggi(app, '<!DOCTYPE html><html><head><title>Carta</title></head><body><main>'
    + '<p>Men&uacute;: cr&egrave;me br&ucirc;l&eacute;e, ni&ntilde;o, Fran&ccedil;ois, Stra&szlig;e.</p>'
    + '</main></body></html>');

  expect(out.ok).toBe(true);
  expect(String(out.text)).not.toContain('&');
  expect(String(out.text)).toContain('François');
  expect(String(out.text)).toContain('niño');
});

test('un attributo che contiene un maggiore non fa sbucare il codice fra il testo', async ({ app, openTab }) => {
  await openTab('filo://newtab/');
  const out = await leggi(app, '<!DOCTYPE html><html><head><title>Listino</title></head><body><main>'
    + '<p>Il modello <a href="/cerca?q=a>b" title="confronto">XZ</a> costa 42 euro.</p>'
    + '</main></body></html>');

  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('42 euro');
  expect(String(out.text)).not.toContain('title=');
  expect(String(out.text)).not.toContain('href=');
});
