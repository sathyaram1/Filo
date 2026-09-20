// #553 giro 6 — i dati che stanno nei controlli di un modulo non arrivano, o
// arrivano incollati fra loro.
//
// Le voci di un menù a tendina (gli orari disponibili, le taglie, i tagli di
// prezzo) e le etichette dei bottoni (il selettore mensile/annuale di ogni
// listino) sono riquadri separati sullo schermo: incollandoli si ottiene
// «10:0014:3018:00», cioè un numero che non esiste. Quello scritto dentro un
// campo precompilato o nel testo alternativo di un'immagine non arriva affatto.

import { test, expect } from '../../fixtures/electron.mjs';

const leggi = (app, html) => app.evaluate(async (_e, pagina) => {
  const orig = globalThis.fetch;
  globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
  globalThis.fetch = async () => new Response(pagina, {
    status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  const r = await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url: 'https://example.com/modulo' });
  return r.output;
}, html);

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

test('gli orari di un menù a tendina non si incollano fra loro', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, '<!DOCTYPE html><html><head><title>Prenota</title></head><body><main>'
    + '<p>Orari disponibili</p><select><option>10:00</option><option>14:30</option><option>18:00</option></select>'
    + '</main></body></html>');
  expect(out.ok).toBe(true);
  expect(String(out.text)).not.toContain('10:0014:30');
  expect(String(out.text)).toContain('14:30');
});

test('le etichette di due bottoni di tariffa non si incollano fra loro', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, '<!DOCTYPE html><html><head><title>Listino</title></head><body><main>'
    + '<button>Mensile 9,99</button><button>Annuale 99,00</button></main></body></html>');
  expect(out.ok).toBe(true);
  expect(String(out.text)).not.toContain('9,99Annuale');
});

test('quello che sta scritto dentro un campo precompilato arriva a Filo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');
  const out = await leggi(app, '<!DOCTYPE html><html><head><title>Prenotazione</title></head><body><main>'
    + '<label>Orario</label><input type="text" value="14:30" readonly>'
    + '<p>Prezzo</p><img src="p.png" alt="12,50 euro"></main></body></html>');
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('14:30');
  expect(String(out.text)).toContain('12,50');
});
