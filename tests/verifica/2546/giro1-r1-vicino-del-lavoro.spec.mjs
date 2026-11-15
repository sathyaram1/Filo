// Verifica #2546, giro 1, rilievo 1: uno strumento sotto tests/ che il ramo sta correggendo usa un file vicino che il
// ramo non aveva toccato prima della critica; la correzione cambia tutti e due. Git vero, Playwright finto.
import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { controllaProveTolte } from '../../../scripts/lib/prove-tolte.mjs';

const STRUMENTO = 'tests/agent/strumento.mjs';
const VICINO = 'tests/agent/vicino.mjs';
const R1 = 'tests/verifica/9999/giro1-r1-strumento.spec.mjs';

test('r1 la correzione che cambia lo strumento e il file vicino che lui usa passa il cancello', () => {
  const dir = cartellaTemporanea('verifica-2546-');
  const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const scrivi = (f, t) => { mkdirSync(dirname(resolve(dir, f)), { recursive: true }); writeFileSync(resolve(dir, f), t); };
  const commit = (m) => { g('add', '-A'); g('commit', '-qm', m); return g('rev-parse', 'HEAD'); };
  try {
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
    scrivi('.gitignore', 'tests/verifica/_tolte-*/\n');
    scrivi(STRUMENTO, "import { base } from './vicino.mjs';\nexport const valore = () => base();\n");
    scrivi(VICINO, "export const base = () => 'rotto';\n");
    commit('main');
    g('checkout', '-q', '-b', 'worker/9999');
    // Il lavoro del ramo prima della critica: lo strumento, non il file vicino.
    scrivi(STRUMENTO, "import { base } from './vicino.mjs';\nexport const valore = () => base(); // primo tentativo\n");
    commit('lavoro del ramo');
    scrivi(R1, "import { valore } from '../../agent/strumento.mjs';\nprocess.exit(valore() === 'giusto' ? 0 : 1);\n");
    const critica = commit('critica');
    // La correzione: una funzione nuova nel file vicino, che lo strumento usa.
    scrivi(VICINO, "export const base = () => 'rotto';\nexport const nuovo = () => 'giusto';\n");
    scrivi(STRUMENTO, "import { nuovo } from './vicino.mjs';\nexport const valore = () => nuovo();\n");
    commit('correzione');
    const sulCodiceNuovo = spawnSync(process.execPath, [resolve(dir, R1)], { encoding: 'utf8' });
    expect(sulCodiceNuovo.status, 'sul codice corretto la prova del rilievo è verde').toBe(0);
    const lancia = (cmd, args, opz) => spawnSync(process.execPath, [resolve(opz.cwd, args.find((a) => a.endsWith('.spec.mjs')))], { cwd: opz.cwd, encoding: 'utf8' });
    const e = controllaProveTolte({ shaPrima: critica, root: dir, conPulizia: false, lancia, prepara: (cmd, args) => ({ ok: true, cmd, args }), log: () => {} });
    expect(e.ferma, e.testo).toBe(false);
  } finally {
    togliCartella(dir);
  }
});
