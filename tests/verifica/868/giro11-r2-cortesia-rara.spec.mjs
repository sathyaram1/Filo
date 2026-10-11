// #868 giro 11 — senza vettori, un messaggio di cortesia non deve ripescare la conversazione vecchia in cui la stessa
// frase di cortesia compare una volta sola.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(join(ROOT, 'src', 'shared', 'contenutoEsterno.js'));
require(join(ROOT, 'src', 'shared', 'chatArchive.js'));
require(join(ROOT, 'src', 'shared', 'filoContesto.js'));
const FC = globalThis.SN_FILO_CONTESTO;

const ORA = Date.now();
function scambio(chat, ore, domanda, risposta) {
  const ts = new Date(ORA - ore * 3600e3).toISOString();
  return [
    { chat, role: 'user', text: domanda, ts, titolo: chat },
    { chat, role: 'filo', text: risposta, ts: new Date(Date.parse(ts) + 5000).toISOString(), titolo: chat },
  ];
}

test('r2 «perfetto grazie» e «grazie mille» non ripescano lo scambio di cortesia di una conversazione vecchia', () => {
  const vecchi = [
    ...scambio('Rata del mutuo', 24 * 8, 'quanto pago di rata del mutuo?', 'La rata è di 640 euro al mese.'),
    ...scambio('Rata del mutuo', 24 * 8 - 0.1, 'perfetto grazie mille', 'Figurati!'),
  ];
  for (let i = 0; i < 10; i++) vecchi.push(...scambio(`altro ${i}`, 24 * 5 + i, `domanda numero ${i}`, `risposta ${i}`));
  vecchi.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const tratti = FC.tratti(vecchi);
  for (const q of ['grazie mille', 'perfetto grazie', 'ok perfetto grazie']) {
    expect(FC.ricordiPerParole(q, tratti).map((r) => r.tratto.titolo), q).toEqual([]);
  }
});
