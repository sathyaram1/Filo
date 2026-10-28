// Sentinella sulle regole della sicurezza dei contatori (#1474): la collezione è a sola creazione, letta solo dall'admin,
// e la forma che accetta è quella che l'app costruisce (src/shared/contatoriSicurezza.js). Rilegge il file che si pubblica;
// gli elenchi come copia del codice li tiene contatoriSicurezza.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
for (const f of ['constants', 'tasti', 'modelUsage', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'contatoriGiornalieri', 'contatoriSicurezza']) {
  require(join(ROOT, 'src', 'shared', `${f}.js`));
}
const C = globalThis.SN_CONTATORI;
const S = globalThis.SN_CONTATORI_SICUREZZA;

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
const DOC = corpo('contatoriSicurezza');
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
  return S.documento({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-28T23', app: '9999.9999.999999', os: 'linux', dati: ora });
}

test('si legge solo da admin, si crea una volta e non si tocca più', () => {
  const allow = [...B.matchAll(/allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g)].map((m) => ({ verbi: m[1].split(',').map((v) => v.trim()), cond: m[2].trim() }));
  const per = (v) => allow.filter((x) => x.verbi.includes(v)).map((x) => x.cond);
  assert.deepEqual(per('get'), ['isAdmin()']);
  assert.deepEqual(per('list'), ['isAdmin()']);
  assert.deepEqual(per('read'), []);
  assert.deepEqual(per('write'), []);
  assert.deepEqual(per('update'), ['false']);
  assert.deepEqual(per('delete'), ['false']);
  assert.deepEqual(per('create'), ['contatoriSicurezza(request.resource.data)']);
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
  assert.equal(C.idDocumento(piena()), `${'a'.repeat(20)}_2026-10-28_23`, 'lo stesso id della sua ora');
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
  assert.ok(S.funzioni().length <= S.FUNZIONI_PREVISTE, 'le funzioni contate hanno passato il tetto delle regole: alzalo e ripubblica');
});

test('il documento più carico dell’app passa; uno con un dominio, un segreto o una categoria inventata no', () => {
  const doc = piena();
  assert.equal(S.valida(doc).ok, true, S.valida(doc).motivo);
  assert.equal(passa(doc), '');
  assert.ok(JSON.stringify(doc).length < 1000000);
  const vuoto = S.documento({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-28T00', app: '0.2.249', os: 'win', dati: {} });
  assert.equal(passa(vuoto), '');
  assert.equal(S.senzaDati(vuoto), true, 'un’ora senza niente della sicurezza non ha il suo documento');
  const manomesso = (campo, v) => passa({ ...doc, [campo]: v });
  assert.notEqual(manomesso('sito_verdetto', { 'pericoloso:banca-falsa.example': '1' }), '', 'un dominio non passa');
  assert.notEqual(manomesso('sito_verdetto', { 'pericoloso:gsb_phishing': 'https://x.it' }), '');
  assert.notEqual(manomesso('sito_approfondito', { 'gsb:ok:1234ms': '1' }), '', 'la durata esce solo in fasce');
  assert.notEqual(manomesso('pagina_delicata', { 'assicurazioni:riquadri': '1' }), '', 'una categoria remota esce «altro»');
  assert.notEqual(manomesso('segreto_oscurato', { 'chiave:Chiave_Di_Prova_Con_Maiuscole': '1' }), '', 'una chiave non passa');
  assert.notEqual(manomesso('segreto_oscurato', { 'chiave:filo-chat': '40x' }), '');
  assert.notEqual(manomesso('uscita_fermata', { 'codice:NAVIGA:482913': '1' }), '', 'il codice letto non passa');
  assert.notEqual(manomesso('uscita_fermata', { 'custodito:portafoglio:naviga': '1' }), '');
  assert.notEqual(manomesso('tetto_toccato', { 'geo_budget:example.com': '1' }), '');
  assert.notEqual(manomesso('avviso_scelta', { 'procedi:pericoloso:dopo': { n: 1 } }), '');
});
