// La guardia delle regole: si pubblica solo da main uguale a origin/main coi file delle regole intatti, ed è
// l'unica strada (nessuno script del pacchetto lancia firebase deploy sulle regole per conto suo). Puro.

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
  ramo: 'main', testa: SHA, origine: SHA, file: ['firestore.rules', 'firestore.indexes.json'], progetto: 'filo-8b9cb', toccati: [],
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
    [{ file: ['firestore.rules'] }, /firebase\.json/],
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
  assert.deepEqual(mod.fileDaPubblicare(fb), ['firestore.rules', 'firestore.indexes.json']);
  assert.equal(mod.progettoDi(rc), 'filo-8b9cb');
  assert.deepEqual(mod.fileDaPubblicare({}), []);
});

test('lo stato di git: un file in stage o modificato conta, uno pulito no', () => {
  assert.deepEqual(mod.fileToccati(' M firestore.rules\0M  firestore.indexes.json\0'), ['firestore.rules', 'firestore.indexes.json']);
  assert.deepEqual(mod.fileToccati(''), []);
});

test('il comando pubblica regole e indici insieme, sul progetto nominato', () => {
  const p = mod.passo({ radice: '/r', progetto: 'filo-8b9cb' });
  assert.equal(p.cmd, 'firebase');
  assert.deepEqual(p.args, ['deploy', '--only', 'firestore:rules,firestore:indexes', '--project', 'filo-8b9cb']);
});

test('una strada sola: regole:pubblica passa dalla guardia, nessun altro script pubblica le regole', () => {
  assert.equal(pkg.scripts['regole:pubblica'], 'node scripts/regole-pubblica.mjs');
  assert.equal(pkg.scripts['deploy:regole'], undefined);
  for (const [nome, cmd] of Object.entries(pkg.scripts)) {
    assert.ok(!/firebase\s+deploy/.test(cmd), `${nome} pubblica scavalcando la guardia: ${cmd}`);
  }
});
