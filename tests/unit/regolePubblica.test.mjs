// La guardia delle regole e della pagina delle approvazioni: si pubblica solo da main uguale a origin/main coi file
// intatti, ed è l'unica strada (firebase.json la richiama a ogni deploy, e nessuno script la scavalca). Puro.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

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
