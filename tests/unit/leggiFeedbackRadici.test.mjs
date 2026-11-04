// #1918: chi stampa un feedback dice al server QUALE ha letto, e il server gli dà le radici del testo e della
// conversazione. Senza il nome, la sessione prenderebbe la radice del solo biglietto e nessun timbro la ripulirebbe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mod = await import(pathToFileURL(join(ROOT, 'scripts', 'leggi-feedback.mjs')).href);

function rete(campi) {
  const fields = {};
  for (const [k, v] of Object.entries(campi)) fields[k] = { stringValue: v };
  return async () => ({ ok: true, status: 200, json: async () => ({ name: 'projects/p/databases/(default)/documents/feedback/f-1508', fields }) });
}

test('la lettura di un feedback con la conversazione delle routine nomina al server il feedback letto', async () => {
  const esito = await mod.leggi('f-1508', {
    bearer: 't', segno: 'k1', decifra: async (g) => ({ ...g }),
    fetchImpl: rete({ status: 'todo', name: 'Titolo', text: 'testo', clientId: 'owner:me', senderProof: 'admin', fiducia: 'fidato', seq: '1508', notes: '[routine verifier] ho provato\n' }),
  });
  assert.equal(esito.codice, 0);
  assert.ok(esito.motivi.length, 'una conversazione scritta da routine si dichiara');
  const chiamate = [];
  const riga = await mod.rigaDellaLettura(esito, { riga: async (cosa, motivi, opts) => { chiamate.push({ cosa, motivi, opts }); return 'ok'; } });
  assert.equal(riga, 'ok');
  assert.equal(chiamate.length, 1);
  assert.deepEqual(chiamate[0].opts.letti, [{ tipo: 'feedback', id: 'f-1508' }], 'senza il nome il server darebbe la radice del solo biglietto');
});

test('una lettura che non sporca non chiama il server', async () => {
  let chiamato = false;
  const riga = await mod.rigaDellaLettura({ motivi: [], letti: [{ tipo: 'feedback', id: 'x' }] }, { riga: async () => { chiamato = true; return 'x'; } });
  assert.equal(riga, '');
  assert.equal(chiamato, false);
});
