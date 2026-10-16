// Sentinella sulle regole dei contatori giornalieri (#969): la collezione è a sola creazione, letta solo dall'admin,
// e la forma che accetta è la stessa che l'app costruisce. Il motore vero la prova contatoriRegole.motore-vero.mjs;
// questa rilegge il file che si pubblica, in millisecondi, come firestoreRulesPaths.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');

require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'modelUsage.js'));
require(join(ROOT, 'src', 'shared', 'contatoriGiornalieri.js'));
const C = globalThis.SN_CONTATORI;

function blocco() {
  const righe = RULES.split('\n');
  const i = righe.findIndex((r) => new RegExp(`^ {4}match\\s+/${C.COLLEZIONE}/\\{`).test(r));
  assert.ok(i >= 0, `manca il blocco match /${C.COLLEZIONE}`);
  const j = righe.findIndex((r, k) => k > i && /^ {4}\}\s*$/.test(r));
  return righe.slice(i, j + 1).join('\n').replace(/\/\/[^\n]*/g, ' ');
}
const B = blocco();

function regole() {
  const out = [];
  const re = /allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g;
  let m;
  while ((m = re.exec(B)) !== null) out.push({ verbi: m[1].split(',').map((v) => v.trim()), cond: m[2].replace(/\s+/g, ' ').trim() });
  return out;
}
const R = regole();
const per = (verbo) => R.filter((r) => r.verbi.includes(verbo));

function elencoDopo(etichetta) {
  const m = new RegExp(`${etichetta}[\\s\\S]*?\\[([^\\]]*)\\]`).exec(B);
  assert.ok(m, `non trovo l'elenco dopo «${etichetta}»`);
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
}

test('si legge solo da admin, si crea una volta e non si tocca più', () => {
  assert.deepEqual(per('get').map((r) => r.cond), ['isAdmin()']);
  assert.deepEqual(per('list').map((r) => r.cond), ['isAdmin()']);
  assert.ok(per('read').length === 0, 'una `read` larga riaprirebbe get e list');
  for (const v of ['update', 'delete']) {
    assert.ok(per(v).length >= 1 && per(v).every((r) => r.cond === 'false'), `${v} deve essere negato in chiaro: un giorno si scrive una volta`);
  }
  assert.ok(per('write').length === 0, 'una `write` scavalcherebbe il no a update e delete');
  assert.equal(per('create').length, 1);
  assert.equal(per('create')[0].cond, 'contatoriValidi(request.resource.data)');
});

test('i campi ammessi sono quelli che l’app costruisce, tutti obbligatori', () => {
  assert.deepEqual(elencoDopo('d\\.keys\\(\\)\\.hasOnly\\('), [...C.CAMPI]);
  assert.deepEqual(elencoDopo('d\\.keys\\(\\)\\.hasAll\\('), [...C.CAMPI]);
  const doc = C.documento({ pseudonimo: 'a'.repeat(20), giorno: '2026-10-15', app: '0.2.243', os: 'win', dati: C.giornoVuoto() });
  assert.deepEqual(Object.keys(doc), [...C.CAMPI]);
});

test('le chiavi di uso ed errori vengono dall’elenco chiuso delle funzioni, lo stesso dell’app', () => {
  const nelleRegole = elencoDopo('function funzioniContate\\(\\)');
  assert.deepEqual(nelleRegole, C.funzioni(),
    'le funzioni delle regole devono essere quelle di SN_CONTATORI.funzioni(), nello stesso ordine. Una funzione nuova va '
    + 'aggiunta qui e le regole ripubblicate (npm run regole:pubblica): finché non lo sono, i giorni che la portano vengono '
    + 'rifiutati e restano in attesa.');
  assert.match(B, /d\.uso is map && d\.uso\.keys\(\)\.hasOnly\(funzioniContate\(\)\)/);
  assert.match(B, /d\.errori is map && d\.errori\.keys\(\)\.hasOnly\(funzioniContate\(\)\)/);
});

test('pseudonimo, giorno, versione e sistema hanno la forma dell’app, e l’id è pseudonimo più giorno', () => {
  const pattern = (campo) => {
    const m = new RegExp(`d\\.${campo}\\.matches\\('([^']+)'\\)`).exec(B);
    assert.ok(m, `manca il controllo di forma su ${campo}`);
    return new RegExp(m[1]);
  };
  const ps = pattern('pseudonimo');
  assert.ok(ps.test('0123456789abcdef0123') && !ps.test('0123456789abcdef') && !ps.test('mario rossi 12345678'));
  const g = pattern('giorno');
  assert.ok(g.test('2026-10-15') && !g.test('15/10/2026'));
  const app = pattern('app');
  assert.ok(app.test('0.2.243') && !app.test('ciao'));
  for (const v of ['0.2.243', '12.0.1']) assert.equal(C.versioneApp(v), v);
  assert.ok(app.test(C.versioneApp('versione strana')), 'la versione di ripiego dell’app deve passare le regole');
  assert.match(B, /docId == d\.pseudonimo \+ '_' \+ d\.giorno/);
  assert.match(B, /d\.giorno\.matches\(d\.mese \+ '-\[0-3\]\[0-9\]'\)/);
  const os = /d\.os in \[([^\]]*)\]/.exec(B);
  assert.ok(os, 'manca l’elenco dei sistemi');
  assert.deepEqual([...os[1].matchAll(/'([^']*)'/g)].map((x) => x[1]), [...C.OS]);
  assert.match(B, /d\.v == (\d+)/);
  assert.equal(Number(/d\.v == (\d+)/.exec(B)[1]), C.VERSIONE);
});
