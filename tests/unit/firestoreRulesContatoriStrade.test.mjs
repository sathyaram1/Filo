// Sentinella sulle regole delle strade dei contatori (#1468): la collezione è a sola creazione, letta solo dall'admin, e
// la forma che accetta è quella che l'app costruisce (src/shared/contatoriStrade.js). Rilegge il file che si pubblica;
// gli elenchi come copia del codice li tiene contatoriStrade.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
for (const f of ['constants', 'tasti', 'modelUsage', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'contatoriGiornalieri', 'contatoriStrade']) {
  require(join(ROOT, 'src', 'shared', `${f}.js`));
}
const C = globalThis.SN_CONTATORI;
const S = globalThis.SN_CONTATORI_STRADE;

const senzaCommenti = (s) => s.replace(/\/\/[^\n]*/g, ' ');
const righe = RULES.split('\n');
const inizio = righe.findIndex((r) => new RegExp(`^ {4}match\\s+/${S.COLLEZIONE}/\\{`).test(r));
assert.ok(inizio >= 0, `manca il blocco match /${S.COLLEZIONE}`);
const fine = righe.findIndex((r, k) => k > inizio && /^ {4}\}\s*$/.test(r));
const B = senzaCommenti(righe.slice(inizio, fine + 1).join('\n'));

function corpo(nome) {
  const m = new RegExp(`function ${nome}\\([^)]*\\)\\s*\\{\\s*return([\\s\\S]*?);\\s*\\}`).exec(B);
  assert.ok(m, `manca la funzione ${nome} nelle regole`);
  return m[1].replace(/\s+/g, ' ').trim();
}
const DOC = corpo('contatoriStrade');
const stringhe = (s) => [...s.matchAll(/'([^']*)'/g)].map((x) => x[1]);
const elencoDopo = (testo, etichetta) => stringhe(new RegExp(`${etichetta}\\(\\[([^\\]]*)\\]`).exec(testo)[1]);

const MAPPE = Object.fromEntries([...DOC.matchAll(/conti\(d\.(\w+), '([^']+)', (\d+), (\d+)\)/g)]
  .map((m) => [m[1], { chiavi: m[2], tettoChiavi: Number(m[3]), tetto: Number(m[4]) }]));
const CONTI = /m\.values\(\)\.join\('#'\)\.matches\('([^']+)'\)/.exec(corpo('conti'))[1];

// Le regole applicate a un documento come le applica il server: chiavi e valori uniti in una stringa ciascuno.
function passa(doc) {
  for (const [campo, r] of Object.entries(MAPPE)) {
    const v = doc[campo];
    if (!v || typeof v !== 'object' || Array.isArray(v)) return `${campo} non è una mappa`;
    const k = Object.keys(v).join('#');
    const valori = Object.values(v);
    if (!valori.every((x) => typeof x === 'string' || Number.isInteger(x))) return `${campo}: un valore non si unisce`;
    if (k.length > r.tettoChiavi || !new RegExp(r.chiavi).test(k)) return `${campo}: chiavi`;
    if (valori.join('#').length > r.tetto || !new RegExp(CONTI).test(valori.join('#'))) return `${campo}: valori`;
  }
  return '';
}

function piena() {
  const ora = {};
  const d = S.dati(ora);
  for (const c of S.MAPPE) for (const k of S.chiaviDi(c)) d[c][k] = 999999999;
  return S.documento({ pseudonimo: 'a'.repeat(20), chiave: '2026-11-01T23', app: '9999.9999.999999', os: 'linux', dati: ora });
}

test('si legge solo da admin, si crea una volta con l’identità anonima e non si tocca più', () => {
  const allow = [...B.matchAll(/allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g)].map((m) => ({ verbi: m[1].split(',').map((v) => v.trim()), cond: m[2].trim() }));
  const per = (v) => allow.filter((x) => x.verbi.includes(v)).map((x) => x.cond);
  assert.deepEqual(per('get'), ['isAdmin()']);
  assert.deepEqual(per('list'), ['isAdmin()']);
  assert.deepEqual(per('read'), []);
  assert.deepEqual(per('write'), []);
  assert.deepEqual(per('update'), ['false']);
  assert.deepEqual(per('delete'), ['false']);
  assert.deepEqual(per('create'), ['request.auth != null && contatoriStrade(request.resource.data)']);
});

test('i campi sono quelli che l’app costruisce, tutti obbligatori, con la testa delle altre ore', () => {
  assert.deepEqual(elencoDopo(DOC, 'd\\.keys\\(\\)\\.hasOnly'), [...S.CAMPI]);
  assert.deepEqual(elencoDopo(DOC, 'd\\.keys\\(\\)\\.hasAll'), [...S.CAMPI]);
  assert.equal(Number(/d\.v == (\d+)/.exec(DOC)[1]), S.VERSIONE);
  assert.deepEqual(Object.keys(piena()), [...S.CAMPI]);
  assert.match(DOC, /docId == d\.pseudonimo \+ '_' \+ d\.giorno \+ '_' \+ d\.ora/);
  assert.deepEqual(stringhe(/d\.os in \[([^\]]*)\]/.exec(DOC)[1]), [...C.OS]);
  const ps = new RegExp(/d\.pseudonimo\.matches\('([^']+)'\)/.exec(DOC)[1]);
  assert.ok(ps.test('0123456789abcdef0123') && !ps.test('mario rossi 12345678'));
  const ora = new RegExp(/d\.ora\.matches\('([^']+)'\)/.exec(DOC)[1]);
  for (let h = 0; h < 24; h++) assert.ok(ora.test(String(h).padStart(2, '0')));
  assert.ok(!ora.test('24') && !ora.test('7'));
  assert.equal(C.idDocumento(piena()), `${'a'.repeat(20)}_2026-11-01_23`, 'lo stesso id della sua ora');
});

test('ogni misura ha nelle regole la forma e i tetti dell’app, e nessuna in più', () => {
  assert.deepEqual(Object.keys(MAPPE).sort(), [...S.MAPPE].sort());
  for (const c of S.MAPPE) {
    assert.equal(MAPPE[c].chiavi, S.FORME.CHIAVI[c], `chiavi di ${c}`);
    assert.deepEqual([MAPPE[c].tettoChiavi, MAPPE[c].tetto], S.TETTI[c], `tetti di ${c}`);
    for (const k of S.chiaviDi(c)) assert.ok(new RegExp(MAPPE[c].chiavi).test(k), `${c}: «${k}» fuori dalle regole`);
  }
  assert.equal(CONTI, S.FORME.CONTI);
  assert.equal(corpo('conti'), `m is map && m.keys().join('#').size() <= tettoChiavi && m.keys().join('#').matches(chiavi) && m.values().join('#').size() <= tetto && m.values().join('#').matches('${S.FORME.CONTI}')`);
});

test('i tetti hanno almeno il doppio dell’elenco intero di oggi', () => {
  for (const c of S.MAPPE) {
    const k = S.chiaviDi(c);
    const [tk, tv] = S.TETTI[c];
    assert.ok(tk >= 2 * k.join('#').length, `${c}: tetto delle chiavi ${tk}, l’elenco ne vuole ${2 * k.join('#').length}`);
    assert.ok(tv >= 2 * k.map(() => '999999999').join('#').length, `${c}: tetto dei conti`);
  }
});

test('il documento più carico dell’app passa; uno con un testo, un indirizzo, un sito o un tasto scritto no', () => {
  const doc = piena();
  assert.equal(S.valida(doc).ok, true, S.valida(doc).motivo);
  assert.equal(passa(doc), '');
  assert.ok(JSON.stringify(doc).length < 1000000);
  const vuoto = S.documento({ pseudonimo: 'a'.repeat(20), chiave: '2026-11-01T00', app: '0.2.255', os: 'win', dati: {} });
  assert.equal(passa(vuoto), '');
  assert.equal(S.senzaDati(vuoto), true, 'un’ora senza questi conti non ha il suo documento');
  const manomesso = (campo, v) => passa({ ...doc, [campo]: v });
  assert.notEqual(manomesso('via_azione', { 'newTab:banca.example': '1' }), '', 'un sito come strada non passa');
  assert.notEqual(manomesso('via_azione', { 'incognito:barra': '1' }), '', 'l’incognito non esce');
  assert.notEqual(manomesso('tasto_da_browser', { ctrl_x: '1' }), '', 'un tasto fuori elenco non passa');
  assert.notEqual(manomesso('tasto_da_browser', { 'a': '1' }), '', 'un tasto che scrive non passa');
  assert.notEqual(manomesso('scorciatoia_a_vuoto', { 'explain-selection:nessuna_selezione': '1' }), '', 'il toast lo conta #1461');
  assert.notEqual(manomesso('menu_nativo_scelto', { 'menu_del_sito:banca.example': '1' }), '', 'il sito non passa');
  assert.notEqual(manomesso('contesto_box', { 'selezione+media+campo': '1' }), '', 'una combinazione non dichiarata è «misto»');
  assert.notEqual(manomesso('navigazione_cronologia', { 'indietro:barra_lista:p16': '1' }), '');
  assert.notEqual(manomesso('pagina_di_filo_aperta', { 'filo://editor/editor.html:barra': '1' }), '', 'un indirizzo non passa');
  assert.notEqual(manomesso('pagina_di_filo_aperta', { 'vista:editor:1234ms': '1' }), '', 'il tempo solo in fasce');
  assert.notEqual(manomesso('aiuto_aperto', { 'ricetta della nonna': '1' }), '');
  assert.notEqual(manomesso('aiuto_aperto', { barra: '12a' }), '');
  assert.notEqual(manomesso('aiuto_aperto', { barra: { n: 1 } }), '');
});
