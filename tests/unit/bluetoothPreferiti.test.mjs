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

test('la chiave dei preferiti scrive l\'elenco degli indirizzi, e l\'elenco nuovo parte da quello di adesso', (t) => {
  assert.ok(s, 'nessuna chiave scrive bluetoothPreferiti');
  // La forma di Linux, qualunque sia la macchina che prova.
  const C = require('../../src/main/services/comandiSistema.js');
  const prima = globalThis.SN_COMANDI_SISTEMA;
  globalThis.SN_COMANDI_SISTEMA = { normalizzaIndirizzo: (p) => C.normalizzaIndirizzo(p, 'linux') };
  t.after(() => { globalThis.SN_COMANDI_SISTEMA = prima; });
  const correnti = { bluetoothPreferiti: ['00:11:22:33:44:55', '66:77:88:99:AA:BB'] };
  const togli = s.build('togli 00:11:22:33:44:55');
  assert.deepEqual(togli.elenco, { percorso: 'bluetoothPreferiti', op: 'togli', voci: ['00:11:22:33:44:55'], nome: 'Dispositivi Bluetooth preferiti' });
  assert.deepEqual(P.applicaElenco(togli.elenco, correnti).partial, { bluetoothPreferiti: ['66:77:88:99:AA:BB'] });
  const aggiungi = s.build('aggiungi 12:34:56:78:9A:BC');
  assert.deepEqual(P.applicaElenco(aggiungi.elenco, correnti).partial.bluetoothPreferiti, ['00:11:22:33:44:55', '66:77:88:99:AA:BB', '12:34:56:78:9A:BC']);
  assert.deepEqual(P.applicaElenco(s.build('svuota').elenco, correnti).partial, { bluetoothPreferiti: [] });
});

// Su Windows l'elenco dei dispositivi dà dodici cifre minuscole, su Mac coppie col trattino: un indirizzo scritto nella
// forma coi due punti deve salvarsi in quella del sistema, o non corrisponde mai a niente.
test('un indirizzo scritto in un\'altra forma si salva in quella dell\'elenco dei dispositivi, e un «togli» lo trova', () => {
  const C = require('../../src/main/services/comandiSistema.js');
  assert.equal(C.normalizzaIndirizzo('00:11:22:33:44:AA', 'win32'), '0011223344aa');
  assert.equal(C.normalizzaIndirizzo('00:11:22:33:44:AA', 'darwin'), '00-11-22-33-44-aa');
  assert.equal(C.normalizzaIndirizzo('0011223344aa', 'linux'), '00:11:22:33:44:AA');
  assert.equal(C.normalizzaIndirizzo('cuffie', 'linux'), null);
  for (const piattaforma of ['win32', 'darwin', 'linux']) {
    const vero = C.normalizzaIndirizzo('00:11:22:33:44:aa', piattaforma);
    assert.ok(C.INDIRIZZO[piattaforma].test(vero), `${piattaforma}: ${vero}`);
  }
  const prima = globalThis.SN_COMANDI_SISTEMA;
  globalThis.SN_COMANDI_SISTEMA = { normalizzaIndirizzo: (p) => C.normalizzaIndirizzo(p, 'win32') };
  try {
    const correnti = { bluetoothPreferiti: ['0011223344aa'] };
    const aggiungi = s.build('aggiungi 66:77:88:99:AA:BB');
    assert.deepEqual(P.applicaElenco(aggiungi.elenco, correnti).partial.bluetoothPreferiti, ['0011223344aa', '66778899aabb']);
    const togli = s.build('togli 00:11:22:33:44:AA');
    assert.deepEqual(P.applicaElenco(togli.elenco, correnti).partial, { bluetoothPreferiti: [] });
    // Ogni forma che la regola dell'indirizzo accetta passa anche a parole: punti e spazi fra le coppie compresi.
    assert.deepEqual(s.build('aggiungi 66.77.88.99.AA.BB').elenco.voci, ['66778899aabb']);
  } finally {
    globalThis.SN_COMANDI_SISTEMA = prima;
  }
});

test('un dispositivo detto per nome non diventa un indirizzo: la risposta dice di usare BLUETOOTH', () => {
  const r = s.build('aggiungi le cuffie Sony');
  assert.match(r.rifiuto, /BLUETOOTH/);
  assert.equal(r.partial, undefined);
});
