// Giro 4 di verifica del lavoro locale clone-worker (#1157): la misura di K su un principale canarino, con un comando
// finto. Con la base rossa, un worker che riproduce il rosso della base e poi cade passa per sano e K esce 2 invece di 1.
// Niente Electron e niente rete: il canarino ha un origin nudo locale.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// Il comando finto: da solo scrive un test verde e uno rosso ed esce 1, come una base con un rosso da carico. Con due
// insieme il worker 2 scrive lo stesso rosso e poi cade nel modo dello scenario.
const FINTO = `
const w = Number(process.env.FILO_WORKER || 0), n = Number(process.env.FILO_WORKER_PARALLELI || 0), s = process.env.SCENARIO || '';
const out = (t) => process.stdout.write(t + '\\n');
out('TAP version 13');
out('# Subtest: un test verde'); out('ok 1 - un test verde'); out('  ---'); out('  duration_ms: 3'); out('  ...');
out('# Subtest: rosso della base'); out('not ok 2 - rosso della base'); out('  ---'); out('  duration_ms: 3'); out("  error: 'boom'"); out('  ...');
if (w === 2 && n > 1) {
  if (s === 'gruppo-interrotto') { out('[test:unit] interrotto al gruppo 1 di 3: i gruppi dopo non sono partiti.'); out('[test:unit] ROSSO: gruppo 1 di 3.'); }
  process.exit(1);
}
out('# tests 2'); out('# pass 1'); out('# fail 1');
out('[test:unit] test rossi (1):'); out('  \\u2716 tests/unit/base.test.mjs:3  rosso della base  (gruppo 1)');
process.exit(1);
`;

function canarino() {
  const base = cartellaTemporanea('misura-k-canarino-');
  const origine = join(base, 'origine.git');
  const princ = join(base, 'princ');
  git(['init', '-q', '--bare', origine], base);
  git(['clone', '-q', origine, princ], base);
  git(['checkout', '-q', '-b', 'main'], princ);
  writeFileSync(join(princ, 'package.json'), '{ "name": "canarino", "version": "1.0.0", "private": true }\n');
  writeFileSync(join(princ, 'package-lock.json'), '{ "name": "canarino", "version": "1.0.0", "lockfileVersion": 3, "requires": true, "packages": { "": { "name": "canarino", "version": "1.0.0" } } }\n');
  writeFileSync(join(princ, '.gitignore'), 'node_modules\n');
  mkdirSync(join(princ, 'tests'), { recursive: true });
  writeFileSync(join(princ, 'tests', 'rossi-noti.json'), '{"specs":[],"contenitore":{"specs":[]}}\n');
  writeFileSync(join(princ, 'finto.mjs'), FINTO);
  git(['add', '-A'], princ);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'canarino'], princ);
  git(['push', '-q', 'origin', 'main'], princ);
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], origine);
  mkdirSync(join(princ, 'node_modules', 'pacchetto'), { recursive: true });
  writeFileSync(join(princ, 'node_modules', 'pacchetto', 'index.js'), 'module.exports = 1;\n');
  return { base, princ };
}

function misura(scenario) {
  const { base, princ } = canarino();
  const dati = join(base, 'k');
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'misura-k.mjs'), '--corse', '1,2', '--spec', '', '--comando', 'node finto.mjs', '--base', dati], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, FILO_REPO_ROOT: princ, SCENARIO: scenario },
  });
  const risultati = JSON.parse(readFileSync(join(dati, 'risultati.json'), 'utf8'));
  return { risultati, uscita: `${r.stdout}\n${r.stderr}` };
}

test.setTimeout(180_000);

test('r1 con la base rossa, un worker che scrive il rosso della base e poi muore senza riepilogo, come un unico gruppo di unit ucciso in cloud, porta K a 1', () => {
  const { risultati, uscita } = misura('morto-dopo-il-rosso');
  expect(risultati.corse[1].codici, uscita).toEqual([1, 1]);
  expect(risultati.k, `il worker 2 non ha finito i suoi test ma la corsa da due è promossa:\n${uscita}`).toBe(1);
});

test('r1 con la base rossa, un worker col gruppo di unit interrotto dopo il rosso della base porta K a 1', () => {
  const { risultati, uscita } = misura('gruppo-interrotto');
  expect(risultati.corse[1].codici, uscita).toEqual([1, 1]);
  expect(risultati.k, `i gruppi dopo il primo non sono partiti nel worker 2 ma la corsa da due è promossa:\n${uscita}`).toBe(1);
});
