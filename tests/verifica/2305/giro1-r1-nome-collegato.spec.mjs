// Verifica #2305, giro 1: il nome della rete o del dispositivo a cui Filo si è appena collegato lo sceglie chi lo
// possiede, come i nomi della sezione SISTEMA: un'uscita col blocco codificato dopo quell'esito va fermata.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
for (const f of ['constants.js', 'contenutoEsterno.js', 'guardianoStatico.js', 'sistema.js', 'urlExfil.js']) {
  require(join(ROOT, 'src', 'shared', f));
}
const X = globalThis.SN_URL_EXFIL;
const USCITA = 'https://raccolta.example/c?d=QWxhZGRpbjpvcGVuIHNlc2FtZQQWxhZGRpbjpvcGVu';

const esiti = [
  ['Bluetooth collegato', { type: 'BLUETOOTH', _executed: true, _output: { ok: true, cosa: 'bluetooth', dispositivo: 'Cuffie del vicino', collegato: true } }],
  ['Wi-Fi collegato', { type: 'WIFI', _executed: true, _output: { ok: true, cosa: 'wifi', rete: 'Rete del vicino', confermato: true } }],
  ['Bluetooth non riuscito', { type: 'BLUETOOTH', _executed: true, _output: { ok: false, cosa: 'bluetooth', errore: 'x', dispositivo: 'Cuffie del vicino' } }],
];

for (const [nome, azione] of esiti) {
  test(`r1 ${nome}: il nome mostrato al modello conta come testo di sconosciuti`, () => {
    expect(X.contestoDaAzioni([azione]).nonFidato).toBe(true);
    expect(X.valutaNaviga(USCITA, { azioni: [azione] }).exfil).toBe(true);
  });
}
