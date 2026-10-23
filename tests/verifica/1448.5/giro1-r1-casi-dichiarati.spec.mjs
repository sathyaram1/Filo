// Prova del rilievo r1, giro 1 di #1448.5: il numero di casi scritto nei documenti resta lontano dal vero.
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../..');

function specDellaSuite(dir = join(ROOT, 'tests')) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) {
      if (p === join(ROOT, 'tests', 'verifica') || nome === 'node_modules' || nome.startsWith('.')) continue;
      out.push(...specDellaSuite(p));
    } else if (/\.spec\.(js|mjs)$/.test(nome)) out.push(p);
  }
  return out;
}

test('r1 i documenti dichiarano un numero di casi entro il 5% di quelli che la suite contiene', () => {
  const casi = specDellaSuite().reduce((n, f) => n
    + (readFileSync(f, 'utf8').match(/^\s*test(\.only|\.fail|\.skip|\.fixme)?\(/gm) || []).length, 0);
  for (const doc of ['CLAUDE.md', 'README.md']) {
    const testo = readFileSync(join(ROOT, doc), 'utf8');
    for (const m of testo.matchAll(/~\s*([\d.]+)\s+casi/g)) {
      const dichiarato = Number(m[1].replace(/\./g, ''));
      expect(Math.abs(casi - dichiarato) / casi, `${doc} dichiara ~${m[1]} casi, la suite ne ha ${casi}`)
        .toBeLessThan(0.05);
    }
  }
});
