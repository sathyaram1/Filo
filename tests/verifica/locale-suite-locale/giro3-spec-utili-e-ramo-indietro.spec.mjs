// Verifica locale del lavoro «suite-locale», terzo giro.
// Le due porte di questo giro, provate come le incontra chi lavora in locale:
// 1. «far girare solo i test utili»: toccando un file dell'app il comando dei
//    controlli deve trovare gli spec di quell'area (gli spec sono nominati per
//    feature, `tab-archive`, `options-default-models`…, non per modulo: un
//    confronto sul solo nome intero ne trovava 12 su 254 file sorgente);
// 2. con --check (solo i controlli, nessuna fusione chiesta) un ramo rimasto
//    indietro rispetto alla linea principale non deve fermare i controlli:
//    la guardia serve a non scoprire un conflitto DOPO i controlli, ma qui
//    nessuna fusione segue.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.cwd());
const tracked = execFileSync('git', ['ls-files', 'tests/*.spec.mjs'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);

async function mod() {
  return import(pathToFileURL(join(ROOT, 'scripts', 'finish-local.mjs')).href);
}

test('un file dell’app toccato porta con sé gli spec della sua area, e tutti esistono', async () => {
  const m = await mod();
  const casi = [
    ['src/pages/options/options.js', /^tests\/options-/],
    ['src/main/tabs.js', /^tests\/tab-/],
    ['src/pages/feedback/feedback.js', /^tests\/feedback-/],
    ['src/main/menu.js', /^tests\/menu-/],
    ['src/pages/dashboard/dashboard.js', /^tests\/dashboard/],
  ];
  for (const [file, atteso] of casi) {
    const specs = m.specsForChangedFiles([file], tracked);
    expect(specs.some((s) => atteso.test(s)), `${file} → ${specs.join(', ') || '(niente)'}`).toBe(true);
    for (const s of specs) expect(existsSync(join(ROOT, `${s}.spec.mjs`)), `${s} non esiste`).toBe(true);
  }
});

test('la scelta resta mirata: nessuna area tira dentro la suite intera', async () => {
  const m = await mod();
  const files = execFileSync('git', ['ls-files', 'src'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  let conSpec = 0;
  for (const f of files) {
    const specs = m.specsForChangedFiles([f], tracked);
    expect(specs.length, `${f} sceglie ${specs.length} spec`).toBeLessThan(60);
    if (specs.length && specs.every((s) => existsSync(join(ROOT, `${s}.spec.mjs`)))) conSpec++;
  }
  // Più di un file sorgente su tre deve trovare almeno uno spec ESISTENTE: prima erano 12 su 254.
  expect(conSpec).toBeGreaterThan(files.length / 3);
});

test('senza --check il ramo indietro ferma prima dei controlli; con --check no', async () => {
  const m = await mod();
  expect(m.behindMainStop(31)).toMatch(/31 commit/);
  expect(m.behindMainStop(31, { checkOnly: false })).toMatch(/verify-local\.mjs start/);
  expect(m.behindMainStop(31, { checkOnly: true })).toBe('');
  const nota = m.behindMainNota(31);
  expect(nota).toMatch(/31 commit/);
  expect(nota).toMatch(/finish/);
});
