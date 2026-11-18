// #2237.6: uno spec sul ramo e su origin/main senza ripetizioni, al posto del secondo checkout fatto a mano.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARTELLA_CONFRONTO, esitiPerSpec, motivoDelResoconto, portaSpecDelRamo, specDaArgomenti, specDaRifareDaSoli, tieniImmagini, verdettoAffiancato } from '../../scripts/spec-su-main.mjs';
import { apriProvaSulCommit } from '../../scripts/lib/unit-sulla-fusione.mjs';
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
  assert.match(src, /for \(const spec of specDaRifareDaSoli\(prima\.esiti, specs\)\)/, 'chi non parte insieme agli altri si rifà da solo, su tutti e due i lati');
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
  assert.deepEqual(esitiPerSpec(NESSUN_TEST, [spec]), { [spec]: { esito: 'non-corso', rossi: [], motivo: 'Error: No tests found.' } });
  assert.equal(esitiPerSpec(null, [spec])[spec].esito, 'non-corso');
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
  const esiti = esitiPerSpec(report, specs);
  assert.deepEqual(Object.fromEntries(specs.map((s) => [s, esiti[s].esito])), {
    'tests/a.spec.mjs': 'verde',
    'tests/verifica/9/b.spec.mjs': 'rosso',
    'tests/c.spec.mjs': 'non-corso',
    'tests/d.spec.mjs': 'non-corso',
    'tests/e.spec.mjs': 'rosso',
    'tests/f.spec.mjs': 'non-corso',
  });
  assert.equal(esiti['tests/f.spec.mjs'].motivo, 'SyntaxError', 'il motivo di chi non parte è il suo errore, non quello di un altro spec');
});

// Un resoconto con i casi `titoli` di uno spec, ognuno col suo stato.
const resocontoDi = (file, casi, errors = []) => ({
  suites: [{ file, specs: Object.entries(casi).map(([title, status]) => ({ title, file, tests: [{ status }] })), suites: [] }],
  errors,
});

test('#2454 giro 1: il confronto è caso per caso, un caso rosso solo sul ramo resta del ramo', () => {
  const spec = 'tests/verifica/1697.2/giro3-r1-codice.spec.mjs';
  const file = 'verifica/1697.2/giro3-r1-codice.spec.mjs';
  const ramo = esitiPerSpec(resocontoDi(file, { 'r1 vecchio': 'unexpected', 'r1 nuovo': 'unexpected' }), [spec])[spec];
  const main = esitiPerSpec(resocontoDi(file, { 'r1 vecchio': 'unexpected', 'r1 nuovo': 'expected' }), [spec])[spec];
  assert.deepEqual(ramo.rossi, ['r1 vecchio', 'r1 nuovo']);
  const v = verdettoAffiancato({ ramo, main, copia: 'manca' });
  assert.doesNotMatch(v, /c'era già su main, non è del ramo/);
  assert.match(v, /un caso è rosso solo sul ramo, e quello è del ramo: «r1 nuovo»/);
  assert.match(v, /Gli altri rossi del ramo \(1\) c'erano già su main/);
  const tuttiGia = esitiPerSpec(resocontoDi(file, { 'r1 vecchio': 'unexpected', 'r1 nuovo': 'unexpected' }), [spec])[spec];
  assert.match(verdettoAffiancato({ ramo, main: tuttiGia }), /Rosso su tutti e due: c'era già su main/);
});

test('#2454 giro 1: gli errori fuori dai casi si leggono come nel verdetto della suite', () => {
  const spec = 'tests/a.spec.mjs';
  // Un worker che non chiude, senza posizione nel file: in GitHub è rosso, qui anche.
  const senzaFile = esitiPerSpec(resocontoDi('a.spec.mjs', { uno: 'expected' }, [{ message: 'Error: worker process exited unexpectedly' }]), [spec])[spec];
  assert.equal(senzaFile.esito, 'rosso');
  // Un teardown scaduto senza altri rossi è un avviso per la suite, e qui non fa rosso.
  const teardown = esitiPerSpec(resocontoDi('a.spec.mjs', { uno: 'expected' }, [{ message: 'Worker teardown timeout of 30000ms exceeded.' }]), [spec])[spec];
  assert.equal(teardown.esito, 'verde');
  const ramo = esitiPerSpec(resocontoDi('a.spec.mjs', { uno: 'unexpected' }, [{ message: 'boom', location: { file: '/x/ramo/tests/a.spec.mjs' } }]), [spec])[spec];
  const main = esitiPerSpec(resocontoDi('a.spec.mjs', { uno: 'unexpected' }), [spec])[spec];
  assert.match(verdettoAffiancato({ ramo, main }), /solo sul ramo/, 'un errore fuori dai casi solo sul ramo è del ramo');
});

test('#2454 giro 1: uno spec che non parte insieme agli altri si rifà da solo', () => {
  const nc = { esito: 'non-corso', rossi: [], motivo: '' };
  const ok = { esito: 'verde', rossi: [], motivo: '' };
  assert.deepEqual(specDaRifareDaSoli({ 'tests/a.spec.mjs': nc, 'tests/b.spec.mjs': nc, 'tests/c.spec.mjs': ok }, ['tests/a.spec.mjs', 'tests/b.spec.mjs', 'tests/c.spec.mjs']), ['tests/a.spec.mjs', 'tests/b.spec.mjs']);
  assert.deepEqual(specDaRifareDaSoli({ 'tests/a.spec.mjs': nc }, ['tests/a.spec.mjs']), [], 'da solo non si rifà: sarebbe la stessa corsa');
});

test('#2454: su main corre lo spec del ramo, copiato se lì manca o è diverso', () => {
  const dir = cartellaTemporanea('spec-su-main-');
  const repo = join(dir, 'repo');
  const g = (...a) => {
    // Su Windows autocrlf riscrive in CRLF i file del worktree: lo spec uguale non sarebbe più uguale.
    const r = spawnSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: repo, encoding: 'utf8' });
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

// #2384.1: il prima di una schermata è main, fotografato da una prova scritta adesso; le immagini sopravvivono al worktree.
function gitIn(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

test('una prova scritta adesso gira su main e le sue immagini restano dopo che il worktree è stato tolto', () => {
  const root = cartellaTemporanea('filo-specsumain-');
  gitIn(root, ['init', '-q']);
  writeFileSync(join(root, 'README'), 'main\n');
  gitIn(root, ['add', '.']);
  gitIn(root, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'main']);
  const sha = gitIn(root, ['rev-parse', 'HEAD']);
  const spec = 'tests/verifica/2384/giro1-prima.spec.mjs';
  mkdirSync(join(root, dirname(spec)), { recursive: true });
  writeFileSync(join(root, spec), '// la prova scritta adesso\n');

  const albero = apriProvaSulCommit({ root, sha });
  assert.ok(!albero.errore, albero.errore);
  let n;
  const dest = join(root, CARTELLA_CONFRONTO, 'main');
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'vecchia.png'), 'x');
  try {
    const p = portaSpecMancanti({ dir: albero.dir, root, specs: [spec, 'tests/che-non-esiste.spec.mjs'] });
    assert.deepEqual(p, { portati: [spec], assenti: ['tests/che-non-esiste.spec.mjs'] });
    assert.equal(readFileSync(join(albero.dir, spec), 'utf8'), '// la prova scritta adesso\n');
    // Quello che una prova salva: in tests/.shots dalla cartella di lancio, o accanto allo spec.
    mkdirSync(join(albero.dir, 'tests', '.shots'), { recursive: true });
    writeFileSync(join(albero.dir, 'tests', '.shots', 'prima-chiaro.png'), 'png');
    mkdirSync(join(albero.dir, dirname(spec), '.shots'), { recursive: true });
    writeFileSync(join(albero.dir, dirname(spec), '.shots', 'prima-scuro.png'), 'png');
    n = tieniImmagini({ dir: albero.dir, dest });
  } finally {
    assert.ok(albero.chiudi().ok);
  }
  assert.ok(!existsSync(albero.dir), 'il worktree è stato tolto');
  assert.equal(n, 2);
  assert.equal(readFileSync(join(dest, 'prima-chiaro.png'), 'utf8'), 'png');
  assert.equal(readFileSync(join(dest, 'verifica', '2384', 'prima-scuro.png'), 'utf8'), 'png');
  assert.ok(!existsSync(join(dest, 'vecchia.png')), 'un\'immagine di una corsa vecchia non passa per nuova');
});

test('uno spec che main ha già resta quello di main: il confronto dei rossi non cambia', () => {
  const root = cartellaTemporanea('filo-specsumain-');
  const dir = cartellaTemporanea('filo-specsumain-albero-');
  for (const [d, testo] of [[root, 'ramo'], [dir, 'main']]) {
    mkdirSync(join(d, 'tests'), { recursive: true });
    writeFileSync(join(d, 'tests', 'x.spec.mjs'), testo);
  }
  assert.deepEqual(portaSpecMancanti({ dir, root, specs: ['tests/x.spec.mjs'] }), { portati: [], assenti: [] });
  assert.equal(readFileSync(join(dir, 'tests', 'x.spec.mjs'), 'utf8'), 'main');
});

test('lo strumento porta le prove mancanti prima di correre e tiene le immagini prima di togliere il worktree', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  const porta = src.indexOf('portaSpecMancanti({ dir: albero.dir');
  const corre = src.indexOf('corri(albero, scelta.specs');
  const tiene = src.indexOf('tieniImmagini({ dir: albero.dir');
  const chiude = src.indexOf('albero.chiudi()');
  assert.ok(porta > 0 && porta < corre, 'la prova va portata prima della corsa');
  assert.ok(tiene > corre && tiene < chiude, 'le immagini vanno prese prima che il worktree se ne vada');
  assert.ok(readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n').includes('tests/.shots/'), 'le immagini tenute non devono finire nei commit');
});
