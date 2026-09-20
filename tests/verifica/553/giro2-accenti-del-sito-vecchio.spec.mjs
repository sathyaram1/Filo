// #553 giro 2 — il prezzo di un vecchio sito italiano arriva a Filo coi
// caratteri rotti.
//
// La codifica si legge solo dall'intestazione della risposta. Un sito che la
// dichiara dove la dichiarano quasi tutti i siti vecchi — dentro la pagina,
// con <meta charset> — viene letto come se fosse UTF-8: accenti, virgolette e
// il simbolo dell'euro diventano il carattere di sostituzione, e il modello
// riferisce all'utente un testo storpiato. Il browser, sulla stessa pagina,
// legge il <meta> e mostra il testo giusto.
//
// Nessuna richiesta esce davvero: la fetch del processo principale è
// sostituita, e serve solo un nome di dominio pubblico perché il controllo
// anti-SSRF lasci passare.

import { test, expect } from '../../fixtures/electron.mjs';

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

test('un sito che dichiara la codifica dentro la pagina si legge lo stesso', async ({ app, openTab }) => {
  await openTab('filo://newtab/');

  const out = await app.evaluate(async () => {
    const pagina = '<!DOCTYPE html><html><head><meta charset="ISO-8859-1">'
      + '<title>Trattoria da Nino</title></head><body><main>'
      + '<p>Il caffè costa 1,20 €, il menù completo 18 €.</p>'
      + '</main></body></html>';
    // I byte come li manda quel sito: una lettera accentata è UN byte.
    const byte = Uint8Array.from([...pagina].map((c) => {
      const n = c.codePointAt(0);
      if (n === 0x20ac) return 0x80; // l'euro, nella tabella di Windows
      return n < 256 ? n : 0x3f;
    }));

    const orig = globalThis.fetch;
    globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
    // Nessun charset nell'intestazione: è il caso comune di quei siti.
    globalThis.fetch = async () => new Response(byte, {
      status: 200, headers: { 'content-type': 'text/html' },
    });

    const r = await globalThis.SN_EXECUTE_FILO_ACTION({
      type: 'LEGGI_PAGINA', url: 'https://example.com/menu',
    });
    return r.output;
  });

  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('caffè');
  expect(String(out.text)).toContain('1,20 €');
  expect(String(out.text)).toContain('menù');
  expect(String(out.text)).not.toContain('�');
});
