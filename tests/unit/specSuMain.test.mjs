// #2237.6: uno spec sul ramo e su origin/main senza ripetizioni, al posto del secondo checkout fatto a mano.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { specDaArgomenti, verdettoAffiancato } from '../../scripts/spec-su-main.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'spec-su-main.mjs');

test('gli spec si scrivono come li vuole Playwright, anche dati senza estensione o con le barre di Windows', () => {
  assert.deepEqual(specDaArgomenti(['tests/editor.spec.mjs', 'tests\\tab-archive', './tests/x']).specs,
    ['tests/editor.spec.mjs', 'tests/tab-archive.spec.mjs', 'tests/x.spec.mjs']);
  assert.match(specDaArgomenti([]).errore, /^Uso:/);
  for (const male of ['src/x.js', 'tests/../../etc/passwd', '--grep=x', 'tests/a b']) {
    assert.match(specDaArgomenti([male]).errore || '', /non è uno spec/, male);
  }
});

test('il verdetto dice di chi è il rosso', () => {
  assert.match(verdettoAffiancato({ ramo: false, main: true }), /lo ha rotto il ramo/);
  assert.match(verdettoAffiancato({ ramo: false, main: false }), /c'era già su main/);
  assert.match(verdettoAffiancato({ ramo: true, main: true }), /Verde/);
  assert.match(verdettoAffiancato({ ramo: true, main: false }), /Rosso solo su main/);
});

test('senza spec si ferma prima di scaricare o aprire niente', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^Uso:/);
});

test('il ruolo di chi verifica nomina lo strumento, e nessun ruolo manda finish:check dietro un filtro', () => {
  const ruoli = join(ROOT, 'routines', 'roles');
  const critica = readFileSync(join(ruoli, '_critica-e-livelli.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(critica, /node scripts\/spec-su-main\.mjs tests\/<nome>\.spec\.mjs/);
  assert.match(critica, /senza filtri \(`\| tail`/, '#1434.2: dietro tail l\'avanzamento non si vede');
  const tutti = [join(ROOT, 'CLAUDE.md'), ...readdirSync(ruoli).filter((f) => f.endsWith('.md')).map((f) => join(ruoli, f))];
  for (const f of tutti) assert.doesNotMatch(readFileSync(f, 'utf8'), /finish:check[^\n`]*\|\s*(tail|head)/, f);
});

test('le corse sono senza ripetizioni e partono dal lancio preparato, come finish:check', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  assert.match(src, /'--retries=0'/);
  assert.match(src, /preparaLancioElectron\(process\.execPath, \[join\(albero\.moduli, '@playwright', 'test', 'cli\.js'\)/);
  assert.match(src, /aggiornaMain\(ROOT\)/, 'main appena scaricata');
});
