// #553 giro 2 — il titolo, la data e la firma dell'articolo spariscono ancora,
// su tutte le pagine che non marcano il corpo con <main> o <article>.
//
// Il giro 1 aveva trovato questa porta e la correzione l'ha chiusa a metà:
// l'intestazione dell'articolo torna a essere contenuto solo DENTRO una zona
// dichiarata. Un sito che impagina il pezzo con dei soli <div> — e sono tanti —
// perde di nuovo l'intestazione, cioè il titolo del pezzo, la data, l'ora e
// l'autore.
//
// Nessuna richiesta esce davvero: la fetch del processo principale è
// sostituita, e serve solo un nome di dominio pubblico perché il controllo
// anti-SSRF lasci passare.

import { test, expect } from '../../fixtures/electron.mjs';

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

test('data, ora, firma e titolo del pezzo arrivano anche senza <main> né <article>', async ({ app, openTab }) => {
  await openTab('filo://newtab/');

  const out = await app.evaluate(async () => {
    const html = '<!DOCTYPE html><html><head><title>Il Giornale del Paese</title></head><body>'
      + '<header class="site-header"><nav>Home Cronaca Sport</nav></header>'
      + '<div class="post">'
      + '<header class="entry-header"><h1>Sciopero dei treni</h1>'
      + '<p class="byline">Pubblicato il 12 marzo 2026 alle 14:30 da Anna Bianchi</p></header>'
      + '<div class="entry-content"><p>I convogli si fermano dalle 9 alle 17.</p></div>'
      + '</div><footer class="site-footer">2026</footer></body></html>';

    const orig = globalThis.fetch;
    globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
    globalThis.fetch = async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
    });
    const r = await globalThis.SN_EXECUTE_FILO_ACTION({
      type: 'LEGGI_PAGINA', url: 'https://example.com/cronaca/treni',
    });
    return r.output;
  });

  expect(out.ok).toBe(true);
  // Il corpo c'è: è l'intestazione a mancare, e quella è la risposta a «quando
  // è uscito?» e «chi l'ha scritto?».
  expect(String(out.text)).toContain('dalle 9 alle 17');
  expect(String(out.text)).toContain('12 marzo 2026');
  expect(String(out.text)).toContain('14:30');
  expect(String(out.text)).toContain('Anna Bianchi');
  expect(String(out.text)).toContain('Sciopero dei treni');
  // La cornice del sito resta fuori, come deve.
  expect(String(out.text)).not.toContain('Cronaca Sport');
});
