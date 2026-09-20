// #553 giro 5 — il PDF che il sito offre come file da scaricare.
//
// Filo legge i PDF: quelli presi dal disco e quelli del web, purché il sito
// dichiari «questo è un PDF». Moltissimi siti — orari, bollette, moduli, atti
// comunali — li servono invece come file generico da scaricare, e lì Filo
// risponde all'utente che quell'indirizzo «non è una pagina di testo». Il file
// è lo stesso, e i suoi primi caratteri dicono già cos'è.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const QUI = dirname(fileURLToPath(import.meta.url));
const PDF = readFileSync(resolve(QUI, '..', '..', 'fixtures', 'documenti', 'documento-con-testo.pdf'))
  .toString('base64');

const leggi = (app, tipo) => app.evaluate(async (_e, [ct, dati]) => {
  const orig = globalThis.fetch;
  globalThis.__ripristinaRete = () => { globalThis.fetch = orig; };
  const bytes = Uint8Array.from(atob(dati), (c) => c.charCodeAt(0));
  globalThis.fetch = async () => new Response(bytes, { status: 200, headers: { 'content-type': ct } });
  const r = await globalThis.SN_EXECUTE_FILO_ACTION({
    type: 'LEGGI_PAGINA', url: 'https://example.com/estratto.pdf',
  });
  return r.output;
}, [tipo, PDF]);

test.afterEach(async ({ app }) => {
  await app.evaluate(() => { try { globalThis.__ripristinaRete?.(); } catch (_) {} });
});

test('un PDF servito come file da scaricare si legge lo stesso', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await openTab('filo://newtab/');

  // Metro di paragone: col tipo dichiarato Filo lo legge.
  const dichiarato = await leggi(app, 'application/pdf');
  expect(dichiarato.ok).toBe(true);
  expect(String(dichiarato.text || '')).toContain('Giacenza media');

  // Stesso file, stesso indirizzo: cambia solo l'etichetta che ci mette il sito.
  const generico = await leggi(app, 'application/octet-stream');
  expect(generico.ok).toBe(true);
  expect(String(generico.text || '')).toContain('Giacenza media');
});
