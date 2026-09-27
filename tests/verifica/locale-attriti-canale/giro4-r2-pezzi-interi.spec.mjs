// Prova del giro 4 (verifica locale), rilievo 2, nata dalla prima prova del giro 2: ogni pezzo spostato fuori dalla
// stampa sta nel suo file identico all'originale, anche quando esce un gruppo intero (lo storico) dopo i suoi testi.
// Non apre Filo: la cosa chiesta vive negli strumenti delle routine.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const importa = (p) => import(pathToFileURL(resolve(ROOT, p)).href);
const SOGLIA_STAMPA = 30000;

process.env.FILO_REPO_ROOT = cartellaTemporanea('attriti-g4r2-radice-');

function stampa(fn) {
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  let s = '';
  process.stdout.write = (c) => { s += c; return true; };
  process.stderr.write = () => true;
  try { fn(); } finally { process.stdout.write = o; process.stderr.write = e; }
  return s;
}
const lungo = (n, t = 'parola ') => t.repeat(Math.ceil(n / t.length)).slice(0, n);
const critica = (n) => 'Provato tutto.\n[2i] ' + lungo(n, 'rilievo "fra virgolette" \\ e a capo\n');
const fb = (n, extra = {}) => ({ text: lungo(n), images: [], documents: [], avviso: 'scritto da altri', ...extra });
const B = (role) => ({ role, branch: 'claude/x', id: 'idfinto', num: '999' });

const CASI = [
  ['verifier', 'feedback 2.000 e tre critiche da 2.500', { feedback: fb(2000), history: [2500, 2500, 2500].map((n) => ({ critique: critica(n) })) }],
  ['verifier', 'feedback 7.000', { feedback: fb(7000), history: [] }],
  ['verifier', 'sei decisioni', { feedback: fb(3000), decisioni: Array.from({ length: 6 }, () => ({ domanda: lungo(600), risposta: lungo(600) })) }],
  ['verifier', 'dieci critiche da 12.000 e feedback da 30.000', { feedback: fb(30000), history: Array.from({ length: 10 }, () => ({ critique: critica(12000) })) }],
  ['verifier', 'duecento critiche corte', { feedback: fb(500), history: Array.from({ length: 200 }, () => ({ critique: critica(300) })) }],
  ['verifier', 'feedback di emoji e markup', { feedback: fb(0, { text: '🙂'.repeat(10000) + '<script>x</script>' }) }],
  ['fixer', 'ripresa con critiche', { feedback: fb(8000), ripresa: { domanda: lungo(4000), risposta: lungo(4000) }, history: Array.from({ length: 4 }, () => ({ critique: critica(6000) })) }],
  ['new-work', 'feedback da 50.000 e quaranta immagini', { feedback: fb(50000, { images: Array.from({ length: 40 }, (_, i) => `https://esempio/${lungo(200)}${i}`) }) }],
];

test('la consegna di ogni ruolo sta sotto la soglia, il ruolo resta leggibile, i pezzi spostati sono interi', async () => {
  const d = await importa('scripts/dispatch.mjs');
  for (const [ruolo, nome, dalServer] of CASI) {
    const bucket = B(ruolo);
    const ctx = d.serverCtx(bucket, { payload: dalServer });
    const s = stampa(() => d.emit(bucket, ctx));
    const j = JSON.parse(s);
    expect(s.length, `${ruolo}: ${nome}`).toBeLessThan(SOGLIA_STAMPA);
    const ruoloIntero = d.readRoleInstructions(ruolo, { scope: ctx.scope, caso: j.payload.case }).replace(/\s+$/, '');
    expect(ruoloIntero.length, `${ruolo}: ${nome}`).toBeGreaterThan(1000);
    expect(j.instructions.startsWith(ruoloIntero), `${ruolo}: ${nome}`).toBe(true);
    for (const [campo, f] of Object.entries(j.payload.fileEsterni || {})) {
      const dentro = readFileSync(f, 'utf8');
      const originale = campo.split('.').reduce((o, k) => (o == null ? o : o[k]), ctx);
      // Un file che rimanda a sua volta ad altri file costringe a una seconda caccia: il contenuto dev'essere l'originale.
      if (typeof originale === 'string') expect(dentro, `${ruolo}: ${nome}: ${campo}`).toBe(originale);
      else expect(JSON.parse(dentro), `${ruolo}: ${nome}: ${campo}`).toEqual(originale);
    }
  }
});
