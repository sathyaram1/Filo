// Sentinella sulle regole della finestra dei contatori (#1470): la collezione è a sola creazione, letta solo dall'admin,
// e la forma che accetta è quella che l'app costruisce (src/shared/contatoriFinestra.js). Rilegge il file che si pubblica;
// il motore vero lo prova contatoriRegole.motore-vero.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
for (const f of ['constants', 'tasti', 'modelUsage', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'contatoriGiornalieri', 'contatoriFinestra']) {
  require(join(ROOT, 'src', 'shared', `${f}.js`));
}
const C = globalThis.SN_CONTATORI;
const F = globalThis.SN_CONTATORI_FINESTRA;

const senzaCommenti = (s) => s.replace(/\/\/[^\n]*/g, ' ');
const righe = RULES.split('\n');
const inizio = righe.findIndex((r) => new RegExp(`^ {4}match\\s+/${F.COLLEZIONE}/\\{`).test(r));
assert.ok(inizio >= 0, `manca il blocco match /${F.COLLEZIONE}`);
const fine = righe.findIndex((r, k) => k > inizio && /^ {4}\}\s*$/.test(r));
const B = senzaCommenti(righe.slice(inizio, fine + 1).join('\n'));

function corpo(nome) {
  const m = new RegExp(`function ${nome}\\([^)]*\\)\\s*\\{\\s*return([\\s\\S]*?);\\s*\\}`).exec(B);
  assert.ok(m, `manca la funzione ${nome} nelle regole`);
  return m[1].replace(/\s+/g, ' ').trim();
}
const DOC = corpo('contatoriFinestra');
const stringhe = (s) => [...s.matchAll(/'([^']*)'/g)].map((x) => x[1]);
const elencoDopo = (testo, etichetta) => stringhe(new RegExp(`${etichetta}\\(\\[([^\\]]*)\\]`).exec(testo)[1]);

const MAPPE = Object.fromEntries([...DOC.matchAll(/conti\(d\.(\w+), '([^']+)', (\d+), (\d+)\)/g)]
  .map((m) => [m[1], { chiavi: m[2], tettoChiavi: Number(m[3]), tetto: Number(m[4]) }]));
const CONTI = /m\.values\(\)\.join\('#'\)\.matches\('([^']+)'\)/.exec(corpo('conti'))[1];
const stringa = (campo) => {
  const m = new RegExp(`d\\.${campo} is string && d\\.${campo}\\.matches\\('([^']+)'\\)`).exec(DOC);
  assert.ok(m, `manca il controllo di ${campo}`);
  return m[1];
};

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
  for (const campo of F.STRINGHE) if (typeof doc[campo] !== 'string' || !new RegExp(stringa(campo)).test(doc[campo])) return campo;
  return '';
}

function piena() {
  const ora = {};
  const d = F.dati(ora);
  d.schede = 999999999;
  d.finestre = 999999999;
  d.ambiente = 'oltre:altro:schermo_intero:chiaro';
  for (const c of F.MAPPE) for (const k of F.chiaviDi(c)) d[c][k] = 999999999;
  return F.documento({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-23T23', app: '9999.9999.999999', os: 'linux', dati: ora });
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
  assert.deepEqual(per('create'), ['contatoriFinestra(request.resource.data)']);
});

test('i campi sono quelli che l’app costruisce, tutti obbligatori, con la testa delle altre ore', () => {
  assert.deepEqual(elencoDopo(DOC, 'd\\.keys\\(\\)\\.hasOnly'), [...F.CAMPI]);
  assert.deepEqual(elencoDopo(DOC, 'd\\.keys\\(\\)\\.hasAll'), [...F.CAMPI]);
  assert.equal(Number(/d\.v == (\d+)/.exec(DOC)[1]), F.VERSIONE);
  assert.deepEqual(Object.keys(piena()), [...F.CAMPI]);
  assert.match(DOC, /docId == d\.pseudonimo \+ '_' \+ d\.giorno \+ '_' \+ d\.ora/);
  assert.deepEqual(stringhe(/d\.os in \[([^\]]*)\]/.exec(DOC)[1]), [...C.OS]);
  const ps = new RegExp(/d\.pseudonimo\.matches\('([^']+)'\)/.exec(DOC)[1]);
  assert.ok(ps.test('0123456789abcdef0123') && !ps.test('mario rossi 12345678'));
  const ora = new RegExp(/d\.ora\.matches\('([^']+)'\)/.exec(DOC)[1]);
  for (let h = 0; h < 24; h++) assert.ok(ora.test(String(h).padStart(2, '0')));
  assert.ok(!ora.test('24') && !ora.test('7'));
  const doc = piena();
  assert.equal(C.idDocumento(doc), `${'a'.repeat(20)}_2026-10-23_23`, 'lo stesso id della sua ora');
});

test('ogni misura ha nelle regole la forma e i tetti dell’app, e nessuna in più', () => {
  assert.deepEqual(Object.keys(MAPPE).sort(), [...F.MAPPE].sort());
  for (const c of F.MAPPE) {
    assert.equal(MAPPE[c].chiavi, F.FORME.CHIAVI[c], `chiavi di ${c}`);
    assert.deepEqual([MAPPE[c].tettoChiavi, MAPPE[c].tetto], F.TETTI[c], `tetti di ${c}`);
    for (const k of F.chiaviDi(c)) assert.ok(new RegExp(MAPPE[c].chiavi).test(k), `${c}: «${k}» fuori dalle regole`);
  }
  assert.equal(CONTI, F.FORME.CONTI);
  for (const c of F.STRINGHE) assert.equal(stringa(c), F.FORME[c], `forma di ${c}`);
  assert.equal(corpo('conti'), `m is map && m.keys().join('#').size() <= tettoChiavi && m.keys().join('#').matches(chiavi) && m.values().join('#').size() <= tetto && m.values().join('#').matches('${F.FORME.CONTI}')`);
  assert.ok(F.tipiNotifica().length * 3 <= F.TIPI_PREVISTI * 1.2, 'i tipi di notifica si avvicinano al tetto delle regole: alzalo e ripubblica');
});

test('il documento più carico dell’app passa; uno con un testo, un indirizzo o un nome di file no', () => {
  const doc = piena();
  assert.equal(F.valida(doc).ok, true, F.valida(doc).motivo);
  assert.equal(passa(doc), '');
  assert.ok(JSON.stringify(doc).length < 1000000);
  const vuoto = F.documento({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-23T00', app: '0.2.249', os: 'win', dati: {} });
  assert.equal(passa(vuoto), '');
  assert.equal(F.senzaDati(vuoto), true, 'un’ora senza niente della finestra non ha il terzo documento');
  const manomesso = (campo, v) => passa({ ...doc, [campo]: v });
  for (const k of ['mario rossi:chiusa_x', 'https://x.it/a:scaduta', 'relazione.docx:letta', '<script>:azione_0']) {
    assert.notEqual(manomesso('notifica', { [k]: '1' }), '', `notifica: «${k}» passerebbe`);
  }
  assert.notEqual(manomesso('chiusuraScheda', { 'youtube.com:m1': '1' }), '');
  assert.notEqual(manomesso('voceMenuScheda', { 'tab-proxy-go:us': '1' }), '', 'il paese scelto non esce');
  assert.notEqual(manomesso('riordinoAutomatico', { 'manual:modello:pagina vecchia': '1' }), '', 'il motivo del modello non esce');
  assert.notEqual(manomesso('downloadAzione', { 'pannello:apri_file': 'foto.jpg' }), '');
  assert.notEqual(manomesso('downloadAzione', { 'pannello:apri_file': { n: 1 } }), '');
  assert.notEqual(manomesso('schedaTrascinata', { d1: '1.5' }), '');
  assert.notEqual(manomesso('schedeAperte', '12 schede'), '');
  assert.notEqual(manomesso('ambienteFinestra', '1920x1080'), '');
});
