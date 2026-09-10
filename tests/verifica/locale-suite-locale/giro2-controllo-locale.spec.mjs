// Verifica locale del lavoro «suite-locale», secondo giro.
// Ri-prova le porte del primo giro: il comando dei controlli in locale non
// deve finire in rosso per la verifica che è proprio quella in corso, e le
// istruzioni (repo e file locale fuori dal repo, se c'è) devono indicare
// la stessa fonte per i rossi noti e lo stesso comando al posto della suite.
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());

test('con --check la verifica non registrata è una nota, non un rosso', async () => {
  const mod = await import(pathToFileURL(join(ROOT, 'scripts', 'finish-local.mjs')).href);
  const senzaCheck = mod.esitoVerificaPerCheck({ checkOnly: false, ok: false, reason: 'avviata senza esito' });
  expect(senzaCheck.ferma).toBe(true);
  const conCheck = mod.esitoVerificaPerCheck({ checkOnly: true, ok: false, reason: 'avviata senza esito' });
  expect(conCheck.ferma).toBe(false);
  expect(conCheck.nota).toContain('avviata senza esito');
  const superata = mod.esitoVerificaPerCheck({ checkOnly: true, ok: true });
  expect(superata.ferma).toBe(false);
});

test('gli spec mirati raccolgono anche le prove dei giri committate nel ramo', async () => {
  const mod = await import(pathToFileURL(join(ROOT, 'scripts', 'finish-local.mjs')).href);
  const specs = mod.specsForChangedFiles([
    'CLAUDE.md',
    'tests/verifica/locale-suite-locale/giro1-numeri-istruzioni.spec.mjs',
    'src/pages/options/options.js',
  ]);
  expect(specs).toContain('tests/verifica/locale-suite-locale/giro1-numeri-istruzioni');
  expect(specs).toContain('tests/options');
});

test('le istruzioni indicano una sola fonte per i rossi noti e un solo comando al posto della suite', () => {
  const testi = [readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8'), readFileSync(join(ROOT, 'routines', 'roles', 'verifier.md'), 'utf8')];
  // Il file locale sta fuori dal repo: si controlla solo dove esiste.
  // (sopra il repo; da una worktree in .claude/worktrees/<nome> sono quattro livelli)
  for (const locale of [resolve(ROOT, '..', 'LOCAL.md'), resolve(ROOT, '..', '..', '..', '..', 'LOCAL.md')]) {
    if (existsSync(locale)) { testi.push(readFileSync(locale, 'utf8')); break; }
  }
  for (const t of testi) {
    expect(t).toContain('finish:check');
    expect(t).not.toMatch(/nella memoria di Claude/);
    expect(t).not.toMatch(/~25 min/);
  }
  const noti = JSON.parse(readFileSync(join(ROOT, 'tests', 'rossi-noti.json'), 'utf8'));
  expect(Array.isArray(noti.specs)).toBe(true);
});

function pathToFileURL(p) {
  return new URL(`file:///${p.replace(/\\/g, '/')}`);
}
