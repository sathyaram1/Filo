// #2096 — i dispositivi Bluetooth preferiti a parole (IMPOSTA_PREFERENZA): si tolgono, si svuotano e si scrivono per
// indirizzo; un nome si rifiuta dicendo la strada giusta (BLUETOOTH con preferito, che trova l'indirizzo vero).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
for (const m of ['constants', 'contenutoEsterno', 'nomiSito', 'tasti', 'preferences']) require(`../../src/shared/${m}.js`);
const P = globalThis.SN_PREF;
const s = P.setterDi('bluetoothPreferiti');

test('la chiave dei preferiti scrive l\'elenco degli indirizzi, e l\'elenco nuovo parte da quello di adesso', () => {
  assert.ok(s, 'nessuna chiave scrive bluetoothPreferiti');
  const correnti = { bluetoothPreferiti: ['00:11:22:33:44:55', '66:77:88:99:AA:BB'] };
  const togli = s.build('togli 00:11:22:33:44:55');
  assert.deepEqual(togli.elenco, { percorso: 'bluetoothPreferiti', op: 'togli', voci: ['00:11:22:33:44:55'], nome: 'Dispositivi Bluetooth preferiti' });
  assert.deepEqual(P.applicaElenco(togli.elenco, correnti).partial, { bluetoothPreferiti: ['66:77:88:99:AA:BB'] });
  const aggiungi = s.build('aggiungi 12:34:56:78:9A:BC');
  assert.deepEqual(P.applicaElenco(aggiungi.elenco, correnti).partial.bluetoothPreferiti, ['00:11:22:33:44:55', '66:77:88:99:AA:BB', '12:34:56:78:9A:BC']);
  assert.deepEqual(P.applicaElenco(s.build('svuota').elenco, correnti).partial, { bluetoothPreferiti: [] });
});

test('un dispositivo detto per nome non diventa un indirizzo: la risposta dice di usare BLUETOOTH', () => {
  const r = s.build('aggiungi le cuffie Sony');
  assert.match(r.rifiuto, /BLUETOOTH/);
  assert.equal(r.partial, undefined);
});
