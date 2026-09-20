// #553 giro 1 — il tetto sullo scaricamento taglia senza dirlo.
//
// La segnalazione chiede il tetto di dimensione «con l'avviso "letto fino a
// qui" come già fa LEGGI_DOCUMENTO». Il tetto sul TESTO lo dichiara. Il tetto
// sui BYTE scaricati no: quello che sta dopo sparisce e Filo consegna la
// pagina come se l'avesse letta tutta. Sui documenti dal disco lo stesso caso
// produce un rifiuto che dice quanto pesa il file e qual è il limite.
//
// Nessuna richiesta esce davvero: la fetch del processo principale è
// sostituita, e serve solo un nome di dominio pubblico perché il controllo
// anti-SSRF lasci passare.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../fixtures/electron.mjs';

const PDF = readFileSync(fileURLToPath(new URL('../../fixtures/documenti/documento-con-testo.pdf', import.meta.url))).toString('base64');


test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

test('una pagina troppo grande viene letta a metà, e Filo lo dice', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await openTab('filo://newtab/');

  const out = await app.evaluate(async () => {
    // Pagina vera ma pesante: il dato utile sta in fondo, dopo blocchi di
    // pubblicità che l'estrazione scarta comunque. Un sito che spedisce
    // decine di megabyte di markup non è un caso di laboratorio.
    const zavorra = '<div class="ads">pubblicita</div>'.repeat(900_000);
    const html = '<!DOCTYPE html><html><head><title>Listino</title></head><body><main>'
      + '<p>Il canone mensile e di 19,90 euro.</p>'
      + zavorra
      + '<p>Lo sportello apre alle 9:30.</p>'
      + '</main></body></html>';

    const orig = globalThis.fetch;
    globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
    globalThis.fetch = async () => new Response(html, {
      status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
    });

    const r = await globalThis.SN_EXECUTE_FILO_ACTION({
      type: 'LEGGI_PAGINA', url: 'https://example.com/listino',
    });
    return { byte: html.length, output: r.output };
  });

  expect(out.byte).toBeGreaterThan(25 * 1024 * 1024);
  expect(out.output.ok).toBe(true);
  // Controllo: la parte iniziale è arrivata.
  expect(String(out.output.text)).toContain('19,90');

  // O il dato in fondo arriva, o Filo dichiara di essersi fermato prima: quello
  // che non può fare è consegnare mezza pagina spacciandola per intera.
  const completo = String(out.output.text).includes('9:30');
  const dichiarato = !!out.output.partial || !!out.output.truncated;
  expect(completo || dichiarato).toBe(true);
});

test('un documento arrivato a metà non viene dichiarato danneggiato', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');

  // Un manuale, un contratto scansionato, un estratto conto: PDF che pesano più
  // del tetto, e che quindi arrivano mozzi.
  const out = await app.evaluate(async (_e, b64) => {
    const intero = Buffer.from(b64, 'base64');
    // Stesso documento, ingrassato con spazi legali fra un oggetto e l'altro
    // finché non supera il tetto: quello che arriva è solo l'inizio.
    const enorme = Buffer.concat([
      intero.subarray(0, 9), Buffer.alloc(26 * 1024 * 1024, 0x0a), intero.subarray(9),
    ]);
    const orig = globalThis.fetch;
    globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
    const serviamo = (buf) => {
      globalThis.fetch = async () => new Response(new Uint8Array(buf), {
        status: 200, headers: { 'content-type': 'application/pdf' },
      });
    };
    const leggi = async () => (await globalThis.SN_EXECUTE_FILO_ACTION({
      type: 'LEGGI_PAGINA', url: 'https://example.com/contratto.pdf',
    })).output;
    serviamo(intero);
    const a = await leggi();
    serviamo(enorme);
    const b = await leggi();
    return { intero: a, mozzo: b };
  }, PDF);

  // Controllo: un documento che ci sta tutto si legge.
  expect(out.intero.ok).toBe(true);

  // È il tetto ad averlo tagliato, non l'autore ad averlo rotto. Dare la colpa
  // al documento manda l'utente a cercare un guasto che non c'è.
  expect(out.mozzo.ok).toBe(false);
  expect(String(out.mozzo.detail || '')).not.toContain('danneggiato');
  expect(String(out.mozzo.detail || '')).not.toContain('password');
  expect(String(out.mozzo.detail || '')).toMatch(/MB|grande|parte/);
});
