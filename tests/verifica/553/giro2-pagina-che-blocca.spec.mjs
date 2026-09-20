// #553 giro 2 — una pagina scritta male blocca tutta l'app per minuti.
//
// Il testo di una pagina lo scrive chiunque, e Filo la apre da solo dopo una
// ricerca. L'estrazione gira nel processo principale: finché non ha finito,
// nessuna finestra risponde. Su un HTML pieno di tag mai chiusi il costo non
// cresce con la pagina ma col suo quadrato: 64 KB costano secondi, 256 KB
// quasi un minuto, e il tetto lascia passare venticinque megabyte.
//
// Nessuna richiesta esce davvero: la fetch del processo principale è
// sostituita, e serve solo un nome di dominio pubblico perché il controllo
// anti-SSRF lasci passare.

import { test, expect } from '../../fixtures/electron.mjs';

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

test('una pagina piena di tag mai chiusi non tiene ferma l\'app', async ({ app, openTab }) => {
  test.setTimeout(300_000);
  await openTab('filo://newtab/');

  const out = await app.evaluate(async () => {
    // 256 KB, una misura che qualunque sito raggiunge. L'HTML è rotto come lo
    // sono tante pagine vere, e il dato utile sta in fondo.
    const html = '<html><body>' + '<a'.repeat(128 * 1024) + '<p>Lo sportello apre alle 9:30.</p></body></html>';

    const orig = globalThis.fetch;
    globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
    globalThis.fetch = async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
    });

    const t0 = Date.now();
    const r = await globalThis.SN_EXECUTE_FILO_ACTION({
      type: 'LEGGI_PAGINA', url: 'https://example.com/orari',
    });
    return { ms: Date.now() - t0, byte: html.length, output: r.output };
  });

  expect(out.byte).toBeLessThan(300 * 1024);
  // Il metro è l'utente davanti alla finestra: una lettura che costa più di
  // qualche secondo è l'app ferma per quel tempo.
  expect(out.ms).toBeLessThan(5000);
  // E fermarsi in fretta non vale se si perde la pagina: il dato deve arrivare
  // lo stesso, oppure Filo deve dire di non avercela fatta.
  const arrivato = String(out.output.text || '').includes('9:30');
  const dichiarato = !out.output.ok || !!out.output.partial || !!out.output.truncated;
  expect(arrivato || dichiarato).toBe(true);
});
