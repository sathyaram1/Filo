// finish:check sceglie anche gli spec che importano o lanciano un modulo cambiato (#2551): un aiuto dei test non porta
// il nome di nessuno spec, e cambiarlo correva i soli unit. Oltre la soglia gli spec non partono, ma si dice quanti sono.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { riferimenti, specCheUsano, SOGLIA_SPEC_DI_UN_MODULO } from '../../scripts/lib/spec-che-usano.mjs';
import { cambiatiPerLaScelta, specDellaScelta, motivoDellaScelta } from '../../scripts/finish-local.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('i rimandi: import, export from, import dinamico, require senza estensione, percorsi di join e resolve', () => {
  const noti = new Set(['tests/helpers/a.mjs', 'src/shared/b.js', 'tests/agent/prova.mjs', 'tests/helpers/c.mjs', 'tests/helpers/d.mjs']);
  const testo = [
    "import { a } from './helpers/a.mjs';",
    "export { c } from './helpers/c.mjs';",
    "const d = await import('./helpers/d.mjs');",
    "const b = require('../src/shared/b');",
    "import { test } from '@playwright/test';",
    "spawn(process.execPath, [join(ROOT, 'tests', 'agent', 'prova.mjs')]);",
    "const altro = join(ROOT, 'tests', 'agent', 'non-esiste.mjs');",
    "// import { x } from './helpers/commento.mjs';",
  ].join('\n');
  assert.deepEqual(riferimenti('tests/x.spec.mjs', testo, (p) => noti.has(p)).sort(),
    ['src/shared/b.js', 'tests/agent/prova.mjs', 'tests/helpers/a.mjs', 'tests/helpers/c.mjs', 'tests/helpers/d.mjs']);
  assert.deepEqual(riferimenti('tests/x.spec.mjs', "import { z } from './helpers/tolto.mjs';\n", () => false), ['tests/helpers/tolto.mjs'],
    'un modulo tolto ma ancora importato resta un rimando');
});

test('gli spec che usano un modulo, anche di seconda mano; le prove dei giri no; oltre la soglia si contano e basta', () => {
  const sorgenti = new Map([
    ['tests/uno.spec.mjs', "import { p } from './agent/provaPreparazione.mjs';\n"],
    ['tests/due.spec.mjs', "spawn(process.execPath, [join(ROOT, 'tests', 'agent', 'prova.mjs')]);\n"],
    ['tests/tre.spec.mjs', "import { x } from './helpers/altro.mjs';\n"],
    ['tests/verifica/9/g1.spec.mjs', "import { p } from '../../agent/provaPreparazione.mjs';\n"],
    ['tests/agent/prova.mjs', "import { p } from './provaPreparazione.mjs';\n"],
    ['tests/agent/provaPreparazione.mjs', 'export const p = 1;\n'],
    ['tests/helpers/altro.mjs', 'export const x = 1;\n'],
  ]);
  assert.deepEqual(specCheUsano(['tests/agent/provaPreparazione.mjs'], sorgenti).specs.sort(), ['tests/due', 'tests/uno']);
  assert.deepEqual(specCheUsano(['README.md'], sorgenti), { specs: [], troppoLarghi: [] });
  assert.deepEqual(specCheUsano(['tests/agent/provaPreparazione.mjs'], sorgenti, { soglia: 1 }),
    { specs: [], troppoLarghi: [{ file: 'tests/agent/provaPreparazione.mjs', spec: 2 }] });
});

test('sul repo vero: il caso di #2551 sceglie gli spec della prova da utente, la fixture va oltre la soglia', () => {
  const vuoto = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  const prep = specDellaScelta({ changed: ['tests/agent/provaPreparazione.mjs'], base: vuoto, root: ROOT });
  assert.deepEqual(prep.specs.sort(), ['tests/prova-da-utente', 'tests/prova-da-utente-filo', 'tests/prova-da-utente-tastiera']);
  const fixture = specDellaScelta({ changed: ['tests/fixtures/electron.mjs'], base: vuoto, root: ROOT });
  assert.deepEqual(fixture.specs, []);
  assert.equal(fixture.troppoLarghi.length, 1);
  assert.ok(fixture.troppoLarghi[0].spec > SOGLIA_SPEC_DI_UN_MODULO);
  const riquadri = specDellaScelta({ changed: ['tests/helpers/riquadri.mjs'], base: vuoto, root: ROOT });
  assert.ok(riquadri.specs.length > 50 && riquadri.specs.length <= SOGLIA_SPEC_DI_UN_MODULO, `i riquadri: ${riquadri.specs.length} spec`);
});

test('un ramo che cambia solo un aiuto dei test lancia gli spec che lo usano, e non dice «non li prova nessuno spec»', () => {
  const dir = cartellaTemporanea('spec-che-usano-');
  try {
    const g = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const scrivi = (rel, testo) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), testo); };
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
    scrivi('tests/agent/provaPreparazione.mjs', 'export const preparaFilo = () => 1;\n');
    scrivi('tests/agent/prova.mjs', "import { preparaFilo } from './provaPreparazione.mjs';\npreparaFilo();\n");
    scrivi('tests/prova-da-utente-filo.spec.mjs', "import { preparaFilo } from './agent/provaPreparazione.mjs';\n");
    scrivi('tests/prova-da-utente.spec.mjs', "import { join } from 'node:path';\nconst f = join(ROOT, 'tests', 'agent', 'prova.mjs');\n");
    scrivi('tests/editor-chat.spec.mjs', '');
    g('add', '-A'); g('commit', '-qm', 'base');
    g('checkout', '-q', '-b', 'lavoro');
    scrivi('tests/agent/provaPreparazione.mjs', 'export const preparaFilo = () => 2;\n');
    g('add', '-A'); g('commit', '-qm', 'aiuto');
    const { changed } = cambiatiPerLaScelta({ base: 'main', marker: null, root: dir });
    const { specs, soloCommenti, troppoLarghi } = specDellaScelta({ changed, base: 'main', root: dir });
    assert.deepEqual(specs.sort(), ['tests/prova-da-utente', 'tests/prova-da-utente-filo']);
    assert.equal(motivoDellaScelta({ changed, soloCommenti, troppoLarghi, specs: specs.length }), '');
  } finally {
    togliCartella(dir);
  }
});

test('un modulo usato da troppi spec si nomina col conto, non come «non provato»', () => {
  const larghi = [{ file: 'tests/fixtures/electron.mjs', spec: 721 }];
  const solo = motivoDellaScelta({ changed: ['tests/fixtures/electron.mjs', 'README.md'], troppoLarghi: larghi, specs: 0 });
  assert.match(solo, /gli altri non li prova nessuno spec \(README\.md\)/);
  assert.match(solo, /Non lancio gli spec che usano tests\/fixtures\/electron\.mjs \(721\)/);
  assert.doesNotMatch(solo, /non li prova nessuno spec \([^)]*electron/);
  assert.match(motivoDellaScelta({ changed: ['tests/fixtures/electron.mjs'], troppoLarghi: larghi, specs: 4 }), /^▸ Non lancio gli spec che usano tests\/fixtures\/electron\.mjs \(721\)/);
});
