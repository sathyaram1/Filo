// #746 giro 3, rilievo 2: la pulizia toglie il caso di r1 (messo da parte), le righe del describe intorno a un caso di
// r2 e il suo controllo; un altro caso rosso di r2 resta. Il caso spento cambia titolo e oggi sfugge: va respinta.
// Playwright vero, in un repo temporaneo con un testDir come quello del repo.
import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { controllaCasiDellaPulizia } from '../../../scripts/lib/prove-tolte.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const prepara = (cmd, args) => ({ ok: true, cmd, args, env: undefined, nota: '' });
const lancia = (cmd, args, opz) => {
  const env = Object.fromEntries(Object.entries(opz.env || process.env).filter(([k]) => !/^(TEST_|PW_|PLAYWRIGHT_(?!JSON_OUTPUT_FILE))/.test(k)));
  return spawnSync(cmd, args, { ...opz, env, stdio: 'ignore', timeout: 120_000 });
};

test('la pulizia che spegne un caso rosso togliendogli anche il describe viene respinta', () => {
  test.setTimeout(240_000);
  const dir = cartellaTemporanea('giro746-g3r2-');
  try {
    const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
    const w = (f, t) => { mkdirSync(dirname(resolve(dir, f)), { recursive: true }); writeFileSync(resolve(dir, f), t); };
    const commit = (m) => { g('add', '-A'); g('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', m); return g('rev-parse', 'HEAD'); };
    g('init', '-q', '-b', 'worker/746');
    symlinkSync(resolve(ROOT, 'node_modules'), resolve(dir, 'node_modules'), 'junction');
    w('.gitignore', 'node_modules\ntests/verifica/_tolte-*/\ntest-results/\n');
    w('playwright.config.mjs', "export default { testDir: './tests', testMatch: /.*\\.spec\\.(js|mjs)$/ };\n");
    const testa = "import { test, expect } from '@playwright/test';\n";
    const prova = 'tests/verifica/746/giro1-r1-r2-due-porte.spec.mjs';
    const seconda = "test('r2 seconda porta', () => {\n  expect(1).toBe(2);\n});\n";
    w(prova, testa + "test('r1 messo da parte', () => {\n  expect(1).toBe(2);\n});\n"
      + "test.describe('gruppo', () => {\n  test('r2 prima porta', () => {\n    expect(1).toBe(2);\n  });\n});\n" + seconda);
    const critica = commit('critica');
    // Solo righe tolte: la pulizia lo accetta come tale.
    w(prova, testa + "  test('r2 prima porta', () => {\n  });\n" + seconda);
    const pulizia = commit('pulizia del giro');
    const e = controllaCasiDellaPulizia({ shaCritica: critica, sha: pulizia, root: dir, messi: [1], lancia, prepara, log: () => {} });
    expect(e.ferma, 'la prima porta di r2 era rossa ed è verde dopo la pulizia, sul codice della critica').toBe(true);
    expect(e.testo).toContain('r2 prima porta');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
