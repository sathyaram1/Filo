// Giro 1 della verifica #2012: nella sede owner un feedback fidato su cui una routine ha già scritto deve arrivare
// all'owner almeno nelle sue parti fidate, non essere rifiutato per intero. Non apre Filo: server finto.
import { test, expect } from '@playwright/test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const L = await import(pathToFileURL(join(ROOT, 'scripts', 'leggi-feedback.mjs')).href);

const doc = (campi) => async () => ({ ok: true, status: 200, json: async () => ({ name: 'projects/p/databases/(default)/documents/feedback/x', fields: campi }) });
const decifra = async (g) => ({ ...g });
const conversazione = [
  "--- Aggiornamento dell'agente del 02/11/2026 10:00 ---",
  'Ramo pronto, verifica superata.',
  '--- La tua risposta del 02/11/2026 11:00 ---',
  'va bene, fondi',
].join('\n');

test('r1 nella sede owner un feedback fidato dell\'owner, già lavorato da una routine col biglietto pulito, si legge', async () => {
  const campi = {
    status: { stringValue: 'todo' }, seq: { integerValue: '900' }, name: { stringValue: 'Spec dell\'owner' },
    text: { stringValue: 'SPEC: il testo scritto dall\'owner' }, clientId: { stringValue: 'owner:me' },
    senderProof: { stringValue: 'admin' }, fiducia: { stringValue: 'fidato' }, notes: { stringValue: conversazione },
  };
  const esito = await L.leggi('x', { bearer: 't', fetchImpl: doc(campi), decifra, rifiuta: true, segno: 's1', cartella: join(ROOT, 'tests', '.smoke', 'v2012') });
  expect(esito.rifiuto || '', 'il feedback fidato non deve essere rifiutato per intero').toBe('');
  expect(esito.codice).toBe(0);
  expect(esito.testo).toContain('SPEC: il testo scritto dall\'owner');
});
