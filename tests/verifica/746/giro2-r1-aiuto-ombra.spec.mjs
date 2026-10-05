// #746 giro 2, rilievo 1: chi corregge AGGIUNGE accanto all'aiuto `aiuto.mjs` un `aiuto.js` vuoto; la prova importa
// `./aiuto` e Playwright ora risolve quello nuovo, quindi diventa verde senza codice corretto. La consegna deve fermarsi.
// Playwright vero, in un repo temporaneo: conta come risolve lui, non il nome scritto.
import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { controllaProveTolte } from '../../../scripts/lib/prove-tolte.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const prepara = (cmd, args) => ({ ok: true, cmd, args, env: undefined, nota: '' });
// Il Playwright annidato non deve credersi un worker di quello che sta girando adesso.
const lancia = (cmd, args, opz) => {
  const env = Object.fromEntries(Object.entries(opz.env || process.env).filter(([k]) => !/^(TEST_|PW_|PLAYWRIGHT_(?!JSON_OUTPUT_FILE))/.test(k)));
  return spawnSync(cmd, args, { ...opz, env, stdio: 'ignore', timeout: 120_000 });
};

test('un aiuto nuovo che fa ombra a quello importato senza estensione ferma la consegna', () => {
  test.setTimeout(240_000);
  const dir = cartellaTemporanea('giro746-g2r1-');
  try {
    const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
    const w = (f, t) => { mkdirSync(dirname(resolve(dir, f)), { recursive: true }); writeFileSync(resolve(dir, f), t); };
    const commit = (m) => { g('add', '-A'); g('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', m); return g('rev-parse', 'HEAD'); };
    g('init', '-q', '-b', 'worker/746');
    symlinkSync(resolve(ROOT, 'node_modules'), resolve(dir, 'node_modules'), 'junction');
    w('.gitignore', 'node_modules\ntests/verifica/_tolte-*/\ntest-results/\n');
    w('tests/verifica/746/aiuto.mjs', "export function controlla() {\n  throw new Error('porta aperta');\n}\n");
    w('tests/verifica/746/giro1-r1-x.spec.mjs', "import { test } from '@playwright/test';\nimport { controlla } from './aiuto';\ntest('r1', () => {\n  controlla();\n});\n");
    const critica = commit('critica');
    w('tests/verifica/746/aiuto.js', 'exports.controlla = function () {};\n');
    commit('correzione che aggiunge un aiuto vuoto');
    const ora = lancia('npx', ['playwright', 'test', 'tests/verifica/746', '--retries=0'], { cwd: dir });
    expect(ora.status, 'premessa: con l\'aiuto nuovo la prova del giro è verde senza nessuna correzione').toBe(0);
    const e = controllaProveTolte({ shaPrima: critica, root: dir, lancia, prepara, log: () => {} });
    expect(e.ferma, 'la prova è verde solo per il file aggiunto: la consegna deve fermarsi').toBe(true);
    expect(e.testo).toContain('giro1-r1-x.spec.mjs');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
