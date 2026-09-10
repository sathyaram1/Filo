// Verifica locale del lavoro «suite-locale», primo giro.
// Le istruzioni per chi lavora in locale citano dei numeri e un comando:
// qui si controlla che dicano cose vere sull'albero corrente. Niente Filo
// aperto: sono testi e strumenti da riga di comando.
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());

function specFiles(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'verifica' && e !== 'node_modules') specFiles(p, acc); }
    else if (/\.spec\.(js|mjs)$/.test(e)) acc.push(p);
  }
  return acc;
}

test('CLAUDE.md conta gli spec della suite con lo scarto di un arrotondamento', () => {
  const md = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
  const m = md.match(/SUITE COMPLETA \(~(\d+) spec/);
  expect(m, 'CLAUDE.md dichiara il numero di spec della suite').toBeTruthy();
  const dichiarati = Number(m[1]);
  const reali = specFiles(join(ROOT, 'tests')).length;
  expect(Math.abs(reali - dichiarati)).toBeLessThanOrEqual(15);
});

test('il comando promesso in locale esiste ed è il solo controllo, senza fusione', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  expect(pkg.scripts['finish:check']).toMatch(/finish-local\.mjs --check/);
  const md = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
  expect(md).toContain('npm run finish:check');
  // La stessa decisione va detta anche a chi verifica.
  const verifier = readFileSync(join(ROOT, 'routines', 'roles', 'verifier.md'), 'utf8');
  expect(verifier).toContain('npm run finish:check');
  // E le due istruzioni non devono più promettere la suite intera in locale.
  expect(md).not.toMatch(/~100 spec|~25 min/);
});

test('i rossi noti hanno tutti il loro motivo scritto', () => {
  const j = JSON.parse(readFileSync(join(ROOT, 'tests', 'rossi-noti.json'), 'utf8'));
  const motivi = new Set(j.specsMotivi.map((x) => x.spec));
  for (const s of j.specs) expect(motivi.has(s), `${s} senza motivo`).toBe(true);
});
