// #746 giro 1, rilievo 1: un aiuto della cartella del giro importato senza estensione (`./aiuto`, che Playwright
// risolve) cambiato da chi corregge deve far rilanciare la prova che lo usa, com'era. Playwright qui è finto.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { controllaProveTolte } from '../../../scripts/lib/prove-tolte.mjs';

const preparaFinto = (cmd, args) => ({ ok: true, cmd, args, env: undefined, nota: '' });

// Rossa se un import relativo della prova (con o senza estensione, come li risolve Playwright) dice «rotto».
function lanciaFinto(root) {
  return (_cmd, args) => {
    const prova = resolve(root, args.find((a) => /\.spec\.mjs$/.test(a)));
    const testo = readFileSync(prova, 'utf8');
    const rossa = [...testo.matchAll(/from '(\.\.?\/[^']+)'/g)].some((m) => {
      const base = resolve(dirname(prova), m[1]);
      const f = [base, `${base}.mjs`, `${base}.js`].find((p) => existsSync(p));
      return f && readFileSync(f, 'utf8').includes('rotto');
    });
    return { status: rossa ? 1 : 0 };
  };
}

test('un aiuto importato senza estensione, indebolito da chi corregge, ferma la consegna', () => {
  const dir = cartellaTemporanea('giro746-r1-');
  try {
    const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
    const w = (f, t) => { mkdirSync(dirname(resolve(dir, f)), { recursive: true }); writeFileSync(resolve(dir, f), t); };
    const commit = (m) => { g('add', '-A'); g('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', m); return g('rev-parse', 'HEAD'); };
    g('init', '-q', '-b', 'worker/746');
    w('.gitignore', 'tests/verifica/_tolte-*/\n');
    w('tests/verifica/746/aiuto.mjs', "export function controlla() {\n  throw new Error('rotto');\n}\n");
    w('tests/verifica/746/giro1-r1-x.spec.mjs', "import { test } from '@playwright/test';\nimport { controlla } from './aiuto';\ntest('B', () => {\n  controlla();\n});\n");
    const critica = commit('critica');
    w('tests/verifica/746/aiuto.mjs', 'export function controlla() {\n}\n');
    commit('correzione che indebolisce l\'aiuto');
    const e = controllaProveTolte({ shaPrima: critica, root: dir, lancia: lanciaFinto(dir), prepara: preparaFinto, log: () => {} });
    expect(e.ferma, 'la prova che usa l\'aiuto, rimessa com\'era, è ancora rossa: la consegna si ferma').toBe(true);
    expect(e.testo).toContain('giro1-r1-x.spec.mjs');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('la cartella della prova è quella del repo', () => {
  expect(existsSync(fileURLToPath(new URL('../../../scripts/lib/prove-tolte.mjs', import.meta.url)))).toBe(true);
});
