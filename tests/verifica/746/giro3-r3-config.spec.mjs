// #746 giro 3, rilievo 3: chi corregge filtra il caso rosso dalla configurazione di Playwright (grepInvert); la prova
// del giro diventa verde senza codice corretto, e la consegna deve fermarsi. Repo temporaneo, Playwright vero.
import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { controllaProveTolte } from '../../../scripts/lib/prove-tolte.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const prepara = (cmd, args) => ({ ok: true, cmd, args, env: undefined, nota: '' });
const lancia = (cmd, args, opz) => {
  const env = Object.fromEntries(Object.entries(opz.env || process.env).filter(([k]) => !/^(TEST_|PW_|PLAYWRIGHT_(?!JSON_OUTPUT_FILE))/.test(k)));
  return spawnSync(cmd, args, { ...opz, env, stdio: 'ignore', timeout: 120_000 });
};
const CONFIG = "export default { testDir: './tests', testMatch: /.*\\.spec\\.(js|mjs)$/ };\n";

test('un caso rosso filtrato dalla configurazione di Playwright ferma la consegna', () => {
  test.setTimeout(240_000);
  const dir = cartellaTemporanea('giro746-g3r3-');
  try {
    const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
    const w = (f, t) => { mkdirSync(dirname(resolve(dir, f)), { recursive: true }); writeFileSync(resolve(dir, f), t); };
    const commit = (m) => { g('add', '-A'); g('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', m); return g('rev-parse', 'HEAD'); };
    g('init', '-q', '-b', 'worker/746');
    symlinkSync(resolve(ROOT, 'node_modules'), resolve(dir, 'node_modules'), 'junction');
    w('.gitignore', 'node_modules\ntests/verifica/_tolte-*/\ntest-results/\n');
    w('playwright.config.mjs', CONFIG);
    w('tests/verifica/746/giro1-r1-x.spec.mjs', "import { test, expect } from '@playwright/test';\ntest('r1 porta', () => {\n  expect(1).toBe(2);\n});\ntest('r1 contorno', () => {});\n");
    const critica = commit('critica');
    w('playwright.config.mjs', CONFIG.replace(' };', ', grepInvert: /porta/ };'));
    commit('correzione che filtra il caso');
    const ora = lancia('npx', ['playwright', 'test', 'tests/verifica/746', '--retries=0'], { cwd: dir });
    expect(ora.status, 'premessa: col filtro la prova del giro è verde senza nessuna correzione').toBe(0);
    const e = controllaProveTolte({ shaPrima: critica, root: dir, lancia, prepara, log: () => {} });
    expect(e.ferma, 'la prova è verde solo perché la configurazione salta il caso rosso').toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
