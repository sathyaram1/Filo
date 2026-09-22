// #553 giro 8 — una pagina può ancora tenere ferma tutta l'app, con una riga.
//
// Il secondo giro aveva trovato che il tempo della lettura cresceva col
// QUADRATO della pagina quando dentro c'era una fila di tag mai chiusi. La
// cura ha tolto quel costo dalla scansione dei tag, ma ne resta uno gemello:
// ogni tag di CHIUSURA che non trova il suo aperto ripercorre tutta la pila
// dei tag ancora aperti. Con una fila di aperture e una di chiusure che non
// si corrispondono il costo torna a crescere col quadrato, e l'estrazione gira
// nel processo principale: finché non ha finito, nessuna finestra risponde.

import { test, expect } from '../../fixtures/electron.mjs';

const leggi = (app, html, url = 'https://esempio.it/pesante') => app.evaluate(async (_e, [pagina, indirizzo]) => {
  const orig = globalThis.fetch;
  globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
  globalThis.fetch = async () => new Response(pagina, {
    status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  const t0 = Date.now();
  const r = await globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url: indirizzo });
  return { out: r.output, ms: Date.now() - t0 };
}, [html, url]);

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

test('una pagina da 280 KB non tiene ferma l\'app per secondi', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  await openTab('filo://newtab/');
  // 40.000 aperture e 40.000 chiusure che non si corrispondono: 280 KB, meno
  // di un trentesimo del tetto sull'HTML che Filo attraversa.
  const html = '<!DOCTYPE html><html><head><title>Bar</title></head><body>'
    + '<p>Il caffe costa 1,20 euro</p>'
    + '<b>'.repeat(40000) + '</i>'.repeat(40000)
    + '</body></html>';
  const { out, ms } = await leggi(app, html);
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('1,20');
  // Il tetto sull'HTML è trenta volte questa pagina: se 280 KB costano secondi,
  // una pagina al tetto costa ore di finestra bloccata.
  expect(ms).toBeLessThan(2000);
});
