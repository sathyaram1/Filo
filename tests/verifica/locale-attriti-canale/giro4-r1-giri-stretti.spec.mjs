// Prova del giro 4 (verifica locale), rilievo 1: nei giri stretti del verificatore (chiusura, riallineamento) la
// consegna resta sotto la soglia oltre la quale l'uscita finisce in un file, col testo del ruolo intero e leggibile.
// Non apre Filo: la cosa chiesta vive negli strumenti delle routine.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const importa = (p) => import(pathToFileURL(resolve(ROOT, p)).href);
const SOGLIA_STAMPA = 30000;

process.env.FILO_REPO_ROOT = cartellaTemporanea('attriti-g4-radice-');

const lungo = (n, t = 'parola ') => t.repeat(Math.ceil(n / t.length)).slice(0, n);
const fb = (n) => ({ text: lungo(n), images: [], documents: [], avviso: 'scritto da altri' });
const critica = (n) => 'Provato.\n[2i] ' + lungo(n, 'rilievo x\n');
function stampa(fn) {
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  let s = '';
  process.stdout.write = (c) => { s += c; return true; };
  process.stderr.write = () => true;
  try { fn(); } finally { process.stdout.write = o; process.stderr.write = e; }
  return s;
}
// Un rilievo corretto di media lunghezza: riga del rilievo più passi, circa 1.700 caratteri.
const rilievo = (i) => ({ level: 1, sede: 'i', text: `Rilievo ${i}.\n` + lungo(1700, `passo del rilievo ${i}\n`) });

const CASI = [
  ['chiusura con tre rilievi da 1.700 caratteri', {
    scope: 'chiusura', feedback: fb(2000), history: [critica(3000), critica(3000)].map((c) => ({ critique: c })),
    perimetro: { shaPrima: 'abcdef1234567', rilievi: [1, 2, 3].map(rilievo) },
  }, 'passo del rilievo 3'],
  ['chiusura con una critica al tetto di 12.000 caratteri', {
    scope: 'chiusura', feedback: fb(2000),
    perimetro: { shaPrima: 'abcdef1234567', rilievi: [{ level: 2, sede: 'i', text: 'Rilievo unico.\n' + lungo(11800, 'passo lungo\n') }] },
  }, 'passo lungo'],
  ['riallineamento con un report da 10.000 caratteri', {
    scope: 'riallineamento', feedback: fb(2000),
    perimetro: { shaVerificato: 'abcdef1234567', reportRebase: lungo(10000,'conflitto risolto nel file tale, logica non toccata\n') },
  }, 'conflitto risolto nel file tale'],
];

test('giri stretti: la stampa sta sotto la soglia, il ruolo è intero e il perimetro resta raggiungibile', async () => {
  const d = await importa('scripts/dispatch.mjs');
  for (const [nome, payload, segno] of CASI) {
    const bucket = { role: 'verifier', branch: 'claude/x', id: 'idfinto', num: '999' };
    const ctx = d.serverCtx(bucket, { payload });
    const s = stampa(() => d.emit(bucket, ctx));
    const j = JSON.parse(s);
    const ruolo = d.readRoleInstructions('verifier', { scope: payload.scope }).replace(/\s+$/, '');
    expect(j.instructions.startsWith(ruolo), nome).toBe(true);
    // Il perimetro non si perde: o sta nelle istruzioni, o in un file che le istruzioni o il payload citano.
    const file = [...s.matchAll(/nel file ([^,"]+?), \d+ caratteri/g)].map((m) => m[1].replace(/\\\\/g, '\\'));
    const raggiungibile = j.instructions.includes(segno)
      || file.some((f) => existsSync(f) && readFileSync(f, 'utf8').includes(segno));
    expect(raggiungibile, nome).toBe(true);
    expect.soft(s.length, nome).toBeLessThan(SOGLIA_STAMPA);
  }
});
