// #746 giro 2, rilievo 2: in una prova con tre casi rossi (r1 messo da parte, due porte di r2 da correggere) la pulizia
// toglie il caso di r1 e, intero, anche la prima porta di r2: resta un rosso, e oggi passa. Deve essere respinta.
// `messi`: i numeri dei rilievi messi da parte, che chi registra la pulizia conosce. Playwright vero, repo temporaneo.
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

const caso = (titolo) => `test('${titolo}', () => {\n  expect(1, '${titolo}').toBe(2);\n});\n`;

test('la pulizia che toglie intero un caso rosso di un rilievo da correggere viene respinta', () => {
  test.setTimeout(240_000);
  const dir = cartellaTemporanea('giro746-g2r2-');
  try {
    const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
    const w = (f, t) => { mkdirSync(dirname(resolve(dir, f)), { recursive: true }); writeFileSync(resolve(dir, f), t); };
    const commit = (m) => { g('add', '-A'); g('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', m); return g('rev-parse', 'HEAD'); };
    g('init', '-q', '-b', 'worker/746');
    symlinkSync(resolve(ROOT, 'node_modules'), resolve(dir, 'node_modules'), 'junction');
    w('.gitignore', 'node_modules\ntests/verifica/_tolte-*/\ntest-results/\n');
    const testa = "import { test, expect } from '@playwright/test';\n";
    const prova = 'tests/verifica/746/giro1-r1-r2-due-porte.spec.mjs';
    w(prova, testa + caso('r1 messo da parte') + caso('r2 prima porta') + caso('r2 seconda porta'));
    const critica = commit('critica');
    w(prova, testa + caso('r2 seconda porta'));
    const pulizia = commit('pulizia del giro');
    const e = controllaCasiDellaPulizia({ shaCritica: critica, sha: pulizia, root: dir, messi: [1], lancia, prepara, log: () => {} });
    expect(e.ferma, 'la prima porta di r2 era rossa ed è sparita con la pulizia: deve restare finché il codice non la chiude').toBe(true);
    expect(e.testo).toContain('r2 prima porta');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
