// #746 giro 4, rilievo 1: la pulizia toglie per intero un caso rosso di r2 (da correggere) e passa, se dopo resta un caso
// col suo stesso titolo (due describe) o se il caso nasce da un elenco nel file di supporto. Deve essere respinta.
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

const preparaRepo = (prefisso) => {
  const dir = cartellaTemporanea(prefisso);
  const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  const w = (f, t) => { mkdirSync(dirname(resolve(dir, f)), { recursive: true }); writeFileSync(resolve(dir, f), t); };
  const commit = (m) => { g('add', '-A'); g('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', m); return g('rev-parse', 'HEAD'); };
  g('init', '-q', '-b', 'worker/746');
  symlinkSync(resolve(ROOT, 'node_modules'), resolve(dir, 'node_modules'), 'junction');
  w('.gitignore', 'node_modules\ntests/verifica/_tolte-*/\ntest-results/\n');
  w('playwright.config.mjs', "export default { testDir: './tests', testMatch: /.*\\.spec\\.(js|mjs)$/ };\n");
  return { dir, w, commit };
};

const testa = "import { test, expect } from '@playwright/test';\n";
const r1 = "test('r1 messo da parte', () => {\n  expect(1).toBe(2);\n});\n";
const gruppo = (titolo) => `test.describe('${titolo}', () => {\n  test('r2 salva', () => {\n    expect(1, '${titolo}').toBe(2);\n  });\n});\n`;

test('r1: la pulizia che toglie un caso rosso da correggere con un gemello di titolo nella stessa prova viene respinta', () => {
  test.setTimeout(240_000);
  const { dir, w, commit } = preparaRepo('giro746-g4r1a-');
  try {
    const prova = 'tests/verifica/746/giro1-r1-r2-salva.spec.mjs';
    w(prova, testa + r1 + gruppo('dal menu') + gruppo('dalla scorciatoia'));
    const critica = commit('critica');
    w(prova, testa + gruppo('dalla scorciatoia'));
    const pulizia = commit('pulizia del giro');
    const e = controllaCasiDellaPulizia({ shaCritica: critica, sha: pulizia, root: dir, messi: [1], lancia, prepara, log: () => {} });
    expect(e.ferma, 'la porta «dal menu» di r2 era rossa ed è sparita con la pulizia: deve restare finché il codice non la chiude').toBe(true);
    expect(e.testo).toContain('dal menu');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('r1: la pulizia che toglie da un elenco di supporto la voce di un caso rosso da correggere viene respinta', () => {
  test.setTimeout(240_000);
  const { dir, w, commit } = preparaRepo('giro746-g4r1b-');
  try {
    w('tests/verifica/746/giro1-r1-x.spec.mjs', testa + r1);
    w('tests/verifica/746/porte.mjs', "export const porte = [\n  'dal menu',\n  'dalla scorciatoia',\n];\n");
    w('tests/verifica/746/giro1-r2-salva.spec.mjs', testa + "import { porte } from './porte.mjs';\nfor (const p of porte) {\n  test(`r2 ${p}`, () => {\n    expect(1, p).toBe(2);\n  });\n}\n");
    const critica = commit('critica');
    rmSync(resolve(dir, 'tests/verifica/746/giro1-r1-x.spec.mjs'));
    w('tests/verifica/746/porte.mjs', "export const porte = [\n  'dalla scorciatoia',\n];\n");
    const pulizia = commit('pulizia del giro');
    const e = controllaCasiDellaPulizia({ shaCritica: critica, sha: pulizia, root: dir, messi: [1], lancia, prepara, log: () => {} });
    expect(e.ferma, 'la porta «dal menu» di r2 era rossa ed è sparita con la pulizia: deve restare finché il codice non la chiude').toBe(true);
    expect(e.testo).toContain('r2 dal menu');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
