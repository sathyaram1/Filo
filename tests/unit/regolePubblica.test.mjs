// La guardia delle regole e della pagina delle approvazioni: si pubblica solo da main, coi file pubblicati intatti e
// uguali a origin/main, ed è l'unica strada (firebase.json la richiama a ogni deploy, e nessuno script la scavalca).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mod = await import(pathToFileURL(join(ROOT, 'scripts', 'regole-pubblica.mjs')).href);
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const SHA = 'a'.repeat(40);
const buono = () => ({
  ramo: 'main', testa: SHA, origine: SHA, file: ['firestore.rules', 'firestore.indexes.json', 'storage.rules', 'site/approvazioni'], progetto: 'filo-8b9cb', toccati: [],
});

test('main uguale a origin/main e file intatti: si pubblica', () => {
  assert.deepEqual(mod.decidi(buono()), { ok: true });
});

test('ogni scostamento rifiuta col suo motivo', () => {
  const casi = [
    [{ ramo: 'claude/x' }, /claude\/x.*non su main/],
    [{ ramo: '' }, /testa staccata/],
    [{ testa: 'b'.repeat(40) }, /bbbbbbbbb.*non è origin\/main \(aaaaaaaaa\)/],
    [{ origine: '' }, /origin\/main non si legge/],
    [{ toccati: ['firestore.rules'] }, /modificati e non fusi: firestore\.rules/],
    [{ file: ['firestore.rules', 'firestore.indexes.json'] }, /firebase\.json.*Storage/],
    [{ file: ['firestore.rules', 'firestore.indexes.json', 'storage.rules'] }, /firebase\.json.*pagina delle approvazioni/],
    [{ toccati: ['site/approvazioni/approvazioni.js'] }, /modificati e non fusi: site\/approvazioni\/approvazioni\.js/],
    [{ toccati: ['storage.rules'] }, /modificati e non fusi: storage\.rules/],
    [{ progetto: '' }, /\.firebaserc/],
    [{ errore: 'rete giù' }, /rete giù/],
    [{ testa: 'b'.repeat(40), diversi: ['firestore.rules'] }, /non è origin\/main \(aaaaaaaaa\) e lì cambiano firestore\.rules/],
    [{ testa: 'b'.repeat(40), diversi: ['firebase.json', 'site/approvazioni/index.html'] }, /lì cambiano firebase\.json, site\/approvazioni\/index\.html/],
    [{ testa: 'b'.repeat(40), diversi: [], toccati: ['storage.rules'] }, /modificati e non fusi: storage\.rules/],
  ];
  for (const [delta, atteso] of casi) {
    const d = mod.decidi({ ...buono(), ...delta });
    assert.equal(d.ok, false, JSON.stringify(delta));
    assert.match(d.motivo, atteso);
  }
});

test('i file e il progetto vengono dalla configurazione vera del repo', () => {
  const fb = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
  const rc = JSON.parse(readFileSync(join(ROOT, '.firebaserc'), 'utf8'));
  assert.deepEqual(mod.fileDaPubblicare(fb), ['firestore.rules', 'firestore.indexes.json', 'storage.rules', 'site/approvazioni']);
  assert.equal(mod.progettoDi(rc), 'filo-8b9cb');
  assert.deepEqual(mod.fileDaPubblicare({}), []);
});

test('lo stato di git: un file in stage o modificato conta, uno pulito no', () => {
  assert.deepEqual(mod.fileToccati(' M firestore.rules\0M  firestore.indexes.json\0'), ['firestore.rules', 'firestore.indexes.json']);
  assert.deepEqual(mod.fileToccati(''), []);
});

test('il comando pubblica regole, indici, regole di Storage e pagina insieme, sul progetto nominato, col segno della guardia', () => {
  const p = mod.passo({ radice: '/r', progetto: 'filo-8b9cb' });
  assert.equal(p.cmd, 'firebase');
  assert.deepEqual(p.args, ['deploy', '--only', 'firestore:rules,firestore:indexes,storage,hosting', '--project', 'filo-8b9cb']);
  assert.deepEqual(p.env, { [mod.SEGNO_GUARDIA]: '1' });
});

test('firebase.json richiama la guardia prima di ogni deploy di Firestore, di Storage e della pagina', () => {
  const fb = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
  for (const sezione of ['firestore', 'storage']) {
    assert.deepEqual(fb[sezione].predeploy, ['node scripts/regole-pubblica.mjs --controlla'],
      `firebase deploy a mano su ${sezione} pubblicherebbe da qualunque ramo`);
  }
  assert.equal(fb.hosting.predeploy[0], 'node scripts/regole-pubblica.mjs --controlla',
    'firebase deploy a mano della pagina delle approvazioni pubblicherebbe da qualunque ramo');
});

const silenzio = { log: () => {}, err: () => {} };
const mai = () => { throw new Error('la guardia non deve lanciare firebase'); };

test('--controlla: decide e basta, mai un deploy', async () => {
  const env = { [mod.SEGNO_GUARDIA]: '1' };
  assert.equal(await mod.main(['--controlla'], { leggiStato: buono, esegui: mai, env, ...silenzio }), 0);
  const errori = [];
  const codice = await mod.main(['--controlla'], { leggiStato: () => ({ ...buono(), ramo: 'claude/x' }), esegui: mai, env, log: () => {}, err: (m) => errori.push(m) });
  assert.equal(codice, 3);
  assert.match(errori.join('\n'), /claude\/x.*non su main/);
});

test('--controlla senza il segno: è un firebase deploy a mano, si rifiuta anche da main pulito', async () => {
  const errori = [];
  const codice = await mod.main(['--controlla'], { leggiStato: buono, esegui: mai, env: {}, log: () => {}, err: (m) => errori.push(m) });
  assert.equal(codice, 3);
  assert.match(errori.join('\n'), /npm run regole:pubblica/);
});

test('regole:pubblica lancia firebase col segno, e solo se la guardia passa', async () => {
  const lanci = [];
  const esegui = (p) => { lanci.push(p); return 0; };
  assert.equal(await mod.main([], { leggiStato: buono, esegui, env: {}, ...silenzio }), 0);
  assert.equal(lanci.length, 1);
  assert.equal(lanci[0].env[mod.SEGNO_GUARDIA], '1');
  assert.equal(await mod.main([], { leggiStato: () => ({ ...buono(), toccati: ['storage.rules'] }), esegui, env: {}, ...silenzio }), 3);
  assert.equal(await mod.main(['--dry-run'], { leggiStato: buono, esegui, env: {}, ...silenzio }), 0);
  assert.equal(lanci.length, 1, 'né il rifiuto né la prova a vuoto lanciano firebase');
});

test('una strada sola: regole:pubblica passa dalla guardia, nessun altro script pubblica le regole', () => {
  assert.equal(pkg.scripts['regole:pubblica'], 'node scripts/regole-pubblica.mjs');
  assert.equal(pkg.scripts['deploy:regole'], undefined);
  for (const [nome, cmd] of Object.entries(pkg.scripts)) {
    assert.ok(!/firebase\s+deploy/.test(cmd), `${nome} pubblica scavalcando la guardia: ${cmd}`);
  }
});

test('main superato da una fusione che non tocca ciò che si pubblica: si pubblica, e lo si dice (#1557)', async () => {
  const indietro = () => ({ ...buono(), testa: 'b'.repeat(40), diversi: [] });
  assert.deepEqual(mod.decidi(indietro()), { ok: true });
  const righe = [];
  const env = { [mod.SEGNO_GUARDIA]: '1' };
  assert.equal(await mod.main(['--controlla'], { leggiStato: indietro, esegui: mai, env, log: (m) => righe.push(m), err: () => {} }), 0);
  assert.match(righe.join('\n'), /main \(bbbbbbbbb\) non è origin\/main \(aaaaaaaaa\), ma ciò che si pubblica è identico/);
});

// Come la pubblicazione oraria su GitHub: checkout superficiale di main, e una fusione arriva prima della fetch della guardia.
test('dal checkout superficiale superato da una fusione: passa se ciò che si pubblica non cambia, si ferma se cambia', () => {
  const casa = cartellaTemporanea('filo-1557-regole-');
  const seme = join(casa, 'seme');
  const copia = join(casa, 'copia');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('npm_config_')));
  const git = (cwd, args) => {
    const r = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, env, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const scrivi = (rel, testo) => { mkdirSync(dirname(join(seme, rel)), { recursive: true }); writeFileSync(join(seme, rel), testo, 'utf8'); };
  const fondi = (rel, testo) => { scrivi(rel, testo); git(seme, ['add', '-A']); git(seme, ['commit', '-qm', `fusione su ${rel}`]); };
  const guardia = () => spawnSync(process.execPath, ['scripts/regole-pubblica.mjs', '--dry-run'], { cwd: copia, env, encoding: 'utf8' });
  try {
    mkdirSync(seme);
    git(seme, ['init', '-q', '--initial-branch=main']);
    git(seme, ['config', 'user.email', 't@t']); git(seme, ['config', 'user.name', 't']);
    for (const f of ['firebase.json', '.firebaserc', 'scripts/regole-pubblica.mjs', 'scripts/lib/argomenti.mjs']) {
      mkdirSync(dirname(join(seme, f)), { recursive: true });
      copyFileSync(join(ROOT, f), join(seme, f));
    }
    scrivi('firestore.rules', 'regole\n'); scrivi('firestore.indexes.json', '{}\n'); scrivi('storage.rules', 'storage\n');
    scrivi('site/approvazioni/index.html', '<p>ok</p>\n'); scrivi('README.md', 'base\n');
    git(seme, ['add', '-A']); git(seme, ['commit', '-qm', 'base']);
    git(casa, ['clone', '-q', '--no-local', '--depth', '1', '--branch', 'main', seme, copia]);
    assert.equal(git(copia, ['rev-parse', '--is-shallow-repository']), 'true');

    fondi('README.md', 'altro\n');
    const passa = guardia();
    assert.equal(passa.status, 0, passa.stderr);
    assert.match(passa.stdout, /non è origin\/main \([0-9a-f]{9}\), ma ciò che si pubblica è identico/);
    assert.match(passa.stdout, /prova a vuoto/);

    // Le intestazioni della pagina stanno in firebase.json: una copia ritoccata e non fusa non si pubblica.
    writeFileSync(join(copia, 'firebase.json'), `${readFileSync(join(copia, 'firebase.json'), 'utf8')}\n`, 'utf8');
    assert.match(guardia().stderr, /modificati e non fusi: firebase\.json/);
    git(copia, ['checkout', '--', 'firebase.json']);

    fondi('firestore.rules', 'regole più strette\n');
    const ferma = guardia();
    assert.equal(ferma.status, 3, ferma.stdout);
    assert.match(ferma.stderr, /lì cambiano firestore\.rules/);

    fondi('firebase.json', `${readFileSync(join(ROOT, 'firebase.json'), 'utf8')}\n`);
    assert.match(guardia().stderr, /lì cambiano firebase\.json, firestore\.rules/);
  } finally {
    togliCartella(casa);
  }
});
