// #2237.6: uno spec sul ramo e su origin/main senza ripetizioni, al posto del secondo checkout fatto a mano.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esitiPerSpec, motivoDelResoconto, portaSpecDelRamo, specDaArgomenti, verdettoAffiancato } from '../../scripts/spec-su-main.mjs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

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
  assert.match(src, /const cli = \[join\(albero\.moduli, '@playwright', 'test', 'cli\.js'\), 'test', '--retries=0', '--reporter=list,json'/);
  assert.match(src, /preparaLancioElectron\(process\.execPath, cli\)/);
  assert.match(src, /aggiornaMain\(ROOT\)/, 'main appena scaricata');
  // #2454: l'esito si legge dal resoconto, caso per caso, non dall'uscita di Playwright; su main corre lo spec del ramo.
  assert.match(src, /PLAYWRIGHT_JSON_OUTPUT_FILE: resoconto/);
  assert.match(src, /esitiPerSpec\(report, specs\)/);
  assert.match(src, /portaSpecDelRamo\(\{ root: ROOT, shaRamo, shaMain, specs: scelta\.specs, dir: albero\.dir \}\)/);
});

// #2454: il resoconto vero di Playwright quando lo spec non c'è (verifica #1697.2 giro 3, su origin/main).
const NESSUN_TEST = {
  suites: [],
  errors: [{ message: 'Error: No tests found.\nMake sure that arguments are regular expressions matching test files.' }],
};
const caso = (file, ...stati) => ({ title: 'x', file, tests: stati.map((status) => ({ status })) });

test('#2454: uno spec che non è partito non è un rosso, e il verdetto non dice che c\'era già su main', () => {
  const spec = 'tests/verifica/1697.2/giro3-r1-codice.spec.mjs';
  assert.deepEqual(esitiPerSpec(NESSUN_TEST, [spec]), { [spec]: 'non-corso' });
  assert.equal(motivoDelResoconto(NESSUN_TEST), 'Error: No tests found.');
  assert.equal(motivoDelResoconto(null), 'Playwright non ha lasciato il resoconto');
  const v = verdettoAffiancato({ ramo: 'rosso', main: 'non-corso' });
  assert.doesNotMatch(v, /c'era già/);
  assert.match(v, /Su main non è partito: il confronto non si è fatto/);
  assert.match(verdettoAffiancato({ ramo: 'non-corso', main: 'rosso' }), /Sul ramo non è partito: il confronto non si è fatto/);
  assert.match(verdettoAffiancato({ ramo: 'non-corso', main: 'non-corso' }), /né sul ramo né su main/);
  assert.match(verdettoAffiancato({ ramo: 'rosso', main: 'rosso', copia: 'manca' }), /c'era già su main.*spec del ramo/);
  assert.match(verdettoAffiancato({ ramo: 'rosso', main: 'non-corso', copia: 'manca' }), /aiuti che il ramo aggiunge/);
  assert.doesNotMatch(verdettoAffiancato({ ramo: 'verde', main: 'verde', copia: 'diverso' }), /spec del ramo/);
});

test('#2454: l\'esito è di ogni spec, dai suoi casi, anche dentro i describe', () => {
  const specs = ['tests/a.spec.mjs', 'tests/verifica/9/b.spec.mjs', 'tests/c.spec.mjs', 'tests/d.spec.mjs', 'tests/e.spec.mjs', 'tests/f.spec.mjs'];
  const report = {
    suites: [
      { file: 'a.spec.mjs', specs: [caso('a.spec.mjs', 'expected'), caso('a.spec.mjs', 'skipped')], suites: [] },
      { file: 'verifica/9/b.spec.mjs', specs: [], suites: [{ file: 'verifica/9/b.spec.mjs', specs: [caso('verifica/9/b.spec.mjs', 'expected'), caso('verifica/9/b.spec.mjs', 'unexpected')], suites: [] }] },
      { file: 'c.spec.mjs', specs: [caso('c.spec.mjs', 'skipped')], suites: [] },
      { file: 'e.spec.mjs', specs: [caso('e.spec.mjs', 'expected')], suites: [] },
      { file: 'altro.spec.mjs', specs: [caso('altro.spec.mjs', 'unexpected')], suites: [] },
    ],
    // Un errore fuori dai casi ma nel file (un afterAll rotto) fa rosso lo spec; quello d'importazione resta non partito.
    errors: [
      { message: 'boom', location: { file: '/tmp/x/ramo/tests/e.spec.mjs', line: 3 } },
      { message: 'SyntaxError', location: { file: 'C:\\x\\ramo\\tests\\f.spec.mjs', line: 1 } },
    ],
  };
  assert.deepEqual(esitiPerSpec(report, specs), {
    'tests/a.spec.mjs': 'verde',
    'tests/verifica/9/b.spec.mjs': 'rosso',
    'tests/c.spec.mjs': 'non-corso',
    'tests/d.spec.mjs': 'non-corso',
    'tests/e.spec.mjs': 'rosso',
    'tests/f.spec.mjs': 'non-corso',
  });
});

test('#2454: su main corre lo spec del ramo, copiato se lì manca o è diverso', () => {
  const dir = cartellaTemporanea('spec-su-main-');
  const repo = join(dir, 'repo');
  const g = (...a) => {
    const r = spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  mkdirSync(join(repo, 'tests'), { recursive: true });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'prova@example.invalid');
  g('config', 'user.name', 'prova');
  writeFileSync(join(repo, 'tests', 'uguale.spec.mjs'), 'uguale\n');
  writeFileSync(join(repo, 'tests', 'cambiato.spec.mjs'), 'su main\n');
  g('add', '.');
  g('commit', '-qm', 'main');
  const shaMain = g('rev-parse', 'HEAD');
  mkdirSync(join(repo, 'tests', 'verifica', '1697.2'), { recursive: true });
  writeFileSync(join(repo, 'tests', 'verifica', '1697.2', 'giro3.spec.mjs'), 'solo sul ramo\n');
  writeFileSync(join(repo, 'tests', 'cambiato.spec.mjs'), 'sul ramo\n');
  g('add', '.');
  g('commit', '-qm', 'ramo');
  const shaRamo = g('rev-parse', 'HEAD');
  const albero = join(dir, 'main');
  g('worktree', 'add', '-q', '--detach', albero, shaMain);

  const specs = ['tests/verifica/1697.2/giro3.spec.mjs', 'tests/cambiato.spec.mjs', 'tests/uguale.spec.mjs', 'tests/assente.spec.mjs'];
  const esito = portaSpecDelRamo({ root: repo, shaRamo, shaMain, specs, dir: albero });
  assert.deepEqual(esito.portati, [
    { spec: 'tests/verifica/1697.2/giro3.spec.mjs', motivo: 'manca' },
    { spec: 'tests/cambiato.spec.mjs', motivo: 'diverso' },
  ]);
  assert.deepEqual(esito.mancaSulRamo, ['tests/assente.spec.mjs']);
  assert.equal(readFileSync(join(albero, 'tests', 'verifica', '1697.2', 'giro3.spec.mjs'), 'utf8'), 'solo sul ramo\n');
  assert.equal(readFileSync(join(albero, 'tests', 'cambiato.spec.mjs'), 'utf8'), 'sul ramo\n');
  assert.equal(readFileSync(join(albero, 'tests', 'uguale.spec.mjs'), 'utf8'), 'uguale\n');
  assert.equal(existsSync(join(albero, 'tests', 'assente.spec.mjs')), false);
});
