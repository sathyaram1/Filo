// #2505 giro 2 — la prova dei test nuovi e il suo test trovano le dipendenze anche quando stanno nella cartella sopra
// il repo, come nella copia di fusione di finish:check (lì il test dello strumento è rosso).
import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { provaTestNuovi } from '../../../scripts/lib/prova-test-nuovi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 con le dipendenze nella cartella sopra il repo, uno spec nuovo esce rosso senza il lavoro e verde con', () => {
  test.setTimeout(300_000);
  const sopra = cartellaTemporanea('filo-v2505-sopra-');
  symlinkSync(join(REPO, 'node_modules'), join(sopra, 'node_modules'), 'junction');
  const root = join(sopra, 'repo');
  mkdirSync(root);
  const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), t); };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'prova@example.invalid');
  g('config', 'user.name', 'prova');
  g('config', 'core.hooksPath', join(root, '.git', 'nessun-gancio'));
  scrivi('src/somma.mjs', 'export const somma = (a, b) => a - b;\n');
  g('add', '-A'); g('commit', '-qm', 'base');
  const base = g('rev-parse', 'HEAD');
  scrivi('src/somma.mjs', 'export const somma = (a, b) => a + b;\n');
  scrivi('tests/somma.spec.mjs', [
    "import { test, expect } from '@playwright/test';",
    "import { somma } from '../src/somma.mjs';",
    "test('la somma nello spec', () => { expect(somma(2, 3)).toBe(5); });",
    '',
  ].join('\n'));
  g('add', '-A'); g('commit', '-qm', 'lavoro');
  const p = provaTestNuovi({ root, base, head: g('rev-parse', 'HEAD') });
  expect(p.casi).toEqual([{ file: 'tests/somma.spec.mjs', caso: 'la somma nello spec', senza: 'rosso', con: 'verde' }]);
});

test('r1 il test dello strumento è verde anche nel repo copiato con le dipendenze nella cartella sopra', () => {
  test.setTimeout(600_000);
  const sopra = cartellaTemporanea('filo-v2505-copia-');
  const ramo = join(sopra, 'ramo');
  symlinkSync(join(REPO, 'node_modules'), join(sopra, 'node_modules'), 'junction');
  execFileSync('git', ['-c', `core.hooksPath=${join(sopra, 'ganci')}`, 'worktree', 'add', '-q', '--detach', ramo, 'HEAD'], { cwd: REPO });
  try {
    const r = spawnSync(process.execPath, ['--test', 'tests/unit/provaTestNuovi.test.mjs'], { cwd: ramo, encoding: 'utf8', timeout: 540_000 });
    const rossi = String(r.stdout || '').split('\n').filter((l) => /^not ok /.test(l));
    expect(rossi).toEqual([]);
    expect(r.status).toBe(0);
  } finally {
    try { execFileSync('git', ['worktree', 'remove', '--force', ramo], { cwd: REPO }); } catch (_) { rmSync(ramo, { recursive: true, force: true }); }
  }
});
