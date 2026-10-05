// #746 giro 3, rilievo 1: la prova importa il suo aiuto come cartella (`./lib`, che Playwright risolve in lib/index.js).
// Indebolirlo, alla consegna o nella pulizia, spegne la prova senza codice corretto: entrambe devono fermarsi.
// Playwright vero, in un repo temporaneo con un testDir come quello del repo.
import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { controllaCasiDellaPulizia, controllaProveTolte } from '../../../scripts/lib/prove-tolte.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const prepara = (cmd, args) => ({ ok: true, cmd, args, env: undefined, nota: '' });
const lancia = (cmd, args, opz) => {
  const env = Object.fromEntries(Object.entries(opz.env || process.env).filter(([k]) => !/^(TEST_|PW_|PLAYWRIGHT_(?!JSON_OUTPUT_FILE))/.test(k)));
  return spawnSync(cmd, args, { ...opz, env, stdio: 'ignore', timeout: 120_000 });
};
const AIUTO = "exports.controlla = function () {\n  throw new Error('porta aperta');\n};\n";
const VUOTO = "exports.controlla = function () {\n};\n";

function repo() {
  const dir = cartellaTemporanea('giro746-g3r1-');
  const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  const w = (f, t) => { mkdirSync(dirname(resolve(dir, f)), { recursive: true }); writeFileSync(resolve(dir, f), t); };
  const commit = (m) => { g('add', '-A'); g('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', m); return g('rev-parse', 'HEAD'); };
  g('init', '-q', '-b', 'worker/746');
  symlinkSync(resolve(ROOT, 'node_modules'), resolve(dir, 'node_modules'), 'junction');
  w('.gitignore', 'node_modules\ntests/verifica/_tolte-*/\ntest-results/\n');
  w('playwright.config.mjs', "export default { testDir: './tests', testMatch: /.*\\.spec\\.(js|mjs)$/ };\n");
  w('tests/verifica/746/lib/index.js', AIUTO);
  w('tests/verifica/746/giro1-r2-x.spec.mjs', "import { test } from '@playwright/test';\nimport { controlla } from './lib';\ntest('r2', () => {\n  controlla();\n});\n");
  const verde = () => lancia('npx', ['playwright', 'test', 'tests/verifica/746', '--retries=0'], { cwd: dir }).status === 0;
  return { dir, w, commit, verde, rm: (f) => rmSync(resolve(dir, f)) };
}

test('consegna: l\'aiuto importato come cartella, svuotato, ferma la consegna', () => {
  test.setTimeout(240_000);
  const r = repo();
  try {
    const critica = r.commit('critica');
    r.w('tests/verifica/746/lib/index.js', VUOTO);
    r.commit('correzione che svuota l\'aiuto');
    expect(r.verde(), 'premessa: con l\'aiuto svuotato la prova è verde senza codice corretto').toBe(true);
    const e = controllaProveTolte({ shaPrima: critica, root: r.dir, lancia, prepara, log: () => {} });
    expect(e.ferma, 'la prova è verde solo perché l\'aiuto non controlla più niente').toBe(true);
    expect(e.testo).toContain('giro1-r2-x.spec.mjs');
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('pulizia: togliere righe dell\'aiuto importato come cartella viene respinto', () => {
  test.setTimeout(240_000);
  const r = repo();
  try {
    r.w('tests/verifica/746/giro1-r1-y.spec.mjs', "import { test, expect } from '@playwright/test';\ntest('r1', () => {\n  expect(1).toBe(2);\n});\n");
    const critica = r.commit('critica');
    r.rm('tests/verifica/746/giro1-r1-y.spec.mjs');
    r.w('tests/verifica/746/lib/index.js', VUOTO);
    const pulizia = r.commit('pulizia del giro');
    const e = controllaCasiDellaPulizia({ shaCritica: critica, sha: pulizia, root: r.dir, messi: [1], lancia, prepara, log: () => {} });
    expect(e.ferma, 'la prova di r2 è diventata verde per le righe tolte all\'aiuto, sul codice della critica').toBe(true);
    expect(e.testo).toContain('giro1-r2-x.spec.mjs');
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});
