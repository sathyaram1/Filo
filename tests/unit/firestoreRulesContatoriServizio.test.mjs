// Sentinella sulle regole del servizio dei contatori (#1472): la collezione è a sola creazione, letta solo dall'admin,
// e la forma che accetta è quella che l'app costruisce (src/shared/contatoriServizio.js). Rilegge il file che si pubblica;
// gli elenchi come copia del codice li tiene contatoriServizio.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
for (const f of ['constants', 'tasti', 'modelUsage', 'capabilities', 'actionLevels', 'autonomia', 'onboarding', 'cambi', 'contatoriGiornalieri', 'contatoriSicurezza', 'contatoriServizio']) {
  require(join(ROOT, 'src', 'shared', `${f}.js`));
}
const C = globalThis.SN_CONTATORI;
const S = globalThis.SN_CONTATORI_SERVIZIO;

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
const DOC = corpo('contatoriServizio');
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

// Ogni chiave degli elenchi chiusi, e per le misure aperte il tetto delle voci coi nomi più lunghi che l'app lascia
// uscire, più le righe «altro»: il documento più carico che l'app sa fare.
// Il modello e l'host più lunghi che passano: pezzi di sole lettere o sole cifre, mai uno che sembri una chiave.
const lunghissimo = (i) => `${'m'.repeat(60)}/${'x'.repeat(55)}-${String(i % 1000).padStart(3, '0')}`;
const hostLungo = (i) => `H${'o'.repeat(20)} C${'l'.repeat(20)} ${String(i % 10000).padStart(4, '0')}`;
function piena() {
  const ora = {};
  const d = S.dati(ora);
  for (const c of S.MAPPE) if (!S.aperta(c)) for (const k of S.chiaviDi(c)) d[c][k] = 999999999;
  for (let i = 0; i < S.TETTO_VOCI + 5; i++) {
    S.registraViolazione(ora, { funzione: 'filo-chat', modello: lunghissimo(i), host: hostLungo(i), motivo: 'not-producer', fonte: 'personal' });
    S.registraServitaIgnota(ora, 'filo-chat', lunghissimo(i));
    S.registraNessunHost(ora, 'filo-chat', lunghissimo(i), 'no_provider_allowed');
    S.registraF4(ora, 'capability-uncommandable', S.capacita()[i % S.capacita().length], 'sostituita');
  }
  for (const mv of S.MOTIVI_VIOLAZIONE) for (const fo of S.FONTI) S.registraViolazione(ora, { funzione: 'filo-chat', modello: lunghissimo(999), host: hostLungo(999), motivo: mv, fonte: fo });
  for (const mo of S.MOTIVI_NESSUN_HOST) S.registraNessunHost(ora, 'filo-chat', lunghissimo(998), mo);
  for (const t of S.TIPI_F4) for (const e of S.ESITI_F4) S.registraF4(ora, t, 'new-tab', e);
  for (const c of S.MAPPE) for (const k of Object.keys(d[c])) d[c][k] = 999999999;
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
  assert.deepEqual(per('create'), ['request.auth != null && contatoriServizio(request.resource.data)']);
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
    for (const k of S.chiaviDi(c) || []) assert.ok(new RegExp(MAPPE[c].chiavi).test(k), `${c}: «${k}» fuori dalle regole`);
  }
  assert.equal(CONTI, S.FORME.CONTI);
  assert.equal(corpo('conti'), `m is map && m.keys().join('#').size() <= tettoChiavi && m.keys().join('#').matches(chiavi) && m.values().join('#').size() <= tetto && m.values().join('#').matches('${S.FORME.CONTI}')`);
  assert.ok(S.funzioni().length <= S.FUNZIONI_PREVISTE, 'le funzioni contate hanno passato il tetto delle regole: alzalo e ripubblica');
  const totale = Object.values(MAPPE).reduce((a, r) => a + r.tettoChiavi + r.tetto, 0);
  assert.ok(totale <= 1000000, `i tetti sommano ${totale}: oltre, un documento passerebbe il limite di Firestore (1 MiB)`);
});

test('il documento più carico dell’app passa; uno con una chiave, un codice d’invito, un’email o un motivo inventato no', () => {
  const doc = piena();
  assert.equal(S.valida(doc).ok, true, S.valida(doc).motivo);
  assert.equal(passa(doc), '');
  for (const c of ['politica_violata', 'servita_ignota', 'nessun_host']) {
    const voci = Object.keys(doc[c]);
    assert.equal(voci.filter((k) => k.includes('/')).length, S.TETTO_VOCI, `${c}: le voci col modello si fermano al tetto`);
  }
  assert.ok(JSON.stringify(doc).length < 1000000);
  const vuoto = S.documento({ pseudonimo: 'a'.repeat(20), chiave: '2026-10-28T00', app: '0.2.249', os: 'win', dati: {} });
  assert.equal(passa(vuoto), '');
  assert.equal(S.senzaDati(vuoto), true, 'un’ora senza niente del servizio non ha il suo documento');
  const manomesso = (campo, v) => passa({ ...doc, [campo]: v });
  assert.notEqual(manomesso('politica_violata', { 'filo-chat|a/b|DeepInfra|excluded|sk-or-v1-0123456789abcdef': '1' }), '', 'una chiave non passa');
  assert.notEqual(manomesso('politica_violata', { 'filo-chat|a/b|mario@example.com|excluded|own': '1' }), '', 'un’email come host no');
  assert.notEqual(manomesso('invito', { 'ABCD-EFGH': '1' }), '', 'un codice d’invito non passa');
  assert.notEqual(manomesso('nessun_host', { 'filo-chat|a/b|No allowed providers are available for the selected model': '1' }), '', 'il messaggio del router no');
  assert.notEqual(manomesso('mai_partita', { 'filo-chat|NO_API_KEY': '1' }), '', 'i codici escono minuscoli, dal loro elenco');
  assert.notEqual(manomesso('saldo_spesa', { 'saldo|42': '1' }), '', 'il saldo esce solo in fasce');
  assert.notEqual(manomesso('chiave_ripiego', { '429|riuscito': '1' }), '');
  assert.notEqual(manomesso('f4', { 'complaint|Non riesco a tradurre la pagina|inviata': '1' }), '', 'il testo di una segnalazione no');
  assert.notEqual(manomesso('accesso', { 'esito|ok': 'mario@example.com' }), '', 'un testo come conto no');
  assert.notEqual(manomesso('coda_feedback', { 'voci|n1': { n: 1 } }), '');
});

test('il modello e l’host più lunghi della prova sono davvero quelli che l’app lascia uscire', () => {
  const ora = {};
  S.registraViolazione(ora, { funzione: 'filo-chat', modello: lunghissimo(7), host: hostLungo(7), motivo: 'excluded', fonte: 'own' });
  const [k] = Object.keys(S.dati(ora).politica_violata);
  assert.equal(k, `filo-chat|${lunghissimo(7)}|${hostLungo(7)}|excluded|own`);
  assert.equal(lunghissimo(7).length, 120);
  assert.equal(hostLungo(7).length, 48);
});
