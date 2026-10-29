// `feedback:apri --pacchetto` (SPEC-RIDISEGNO-LAVORO.md § 2 e §3 regola 1): il pacchetto nasce con le segnalazioni
// che unisce, ognuna resta aperta e lo aspetta, e le segnalazioni che non possono entrare fermano tutto prima di
// aprire, coi motivi detti insieme. Rete finta: si guarda cosa arriva a submit e quali attese si scrivono.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const SCRIPT = await import('../../scripts/claude-feedback.mjs');
const FB = globalThis.SN_FEEDBACK;
SCRIPT.credenziale.ottieni = async () => ({ idToken: 'tok-test' });
SCRIPT.ambiente.routine = () => false;

const seg = (num, extra = {}) => ({ ok: true, id: `id${num}`, num, stato: 'todo', priorita: 1, locale: false, attese: [], ...extra });

async function conRete({ lette, attendi = async () => ({ ok: true }), seq = 900 }, fn) {
  const orig = { submit: FB.submit, leggi: SCRIPT.pacchetto.leggi, attendi: SCRIPT.pacchetto.attendi, log: console.log, err: console.error };
  const visti = { submit: [], attese: [], out: [], err: [] };
  FB.submit = async (payload, opts) => { visti.submit.push({ payload, opts }); return { id: 'pacco', seq, senderProof: 'admin' }; };
  SCRIPT.pacchetto.leggi = async (numeri) => numeri.map((n) => lette[n] || { ok: false, num: n, motivo: `nessun feedback #${n}` });
  SCRIPT.pacchetto.attendi = async (id, voce) => { visti.attese.push({ id, voce }); return attendi(id, voce); };
  console.log = (...a) => visti.out.push(a.join(' '));
  console.error = (...a) => visti.err.push(a.join(' '));
  try { return { code: await fn(), ...visti }; } finally {
    FB.submit = orig.submit; SCRIPT.pacchetto.leggi = orig.leggi; SCRIPT.pacchetto.attendi = orig.attendi;
    console.log = orig.log; console.error = orig.err;
  }
}

test('il pacchetto nasce con le segnalazioni unite, ognuna lo aspetta, e prende la priorità più alta fra loro', async () => {
  const r = await conRete({ lette: { 812: seg('812', { priorita: 2 }), 815: seg('815', { attese: [{ id: 'x', num: '700' }] }) } },
    () => SCRIPT.main(['Menu del tasto destro', 'La spec: #812 la voce manca, #815 il hover.', '--non-locale', '--pacchetto', '812,815']));
  assert.equal(r.code, 0, r.err.join('\n'));
  assert.deepEqual(r.submit[0].opts.unisce, [{ id: 'id812', num: '812' }, { id: 'id815', num: '815' }]);
  assert.equal(r.submit[0].opts.priority, 2, 'senza --priorita il pacchetto non sta sotto le sue segnalazioni');
  assert.deepEqual(r.attese.map((a) => [a.id, a.voce.num]), [['id812', '900'], ['id815', '900']]);
  assert.match(r.out.join('\n'), /#812, #815 lo aspettano/);
});

test('una segnalazione che non può entrare ferma tutto prima di aprire, e i motivi si dicono insieme', async () => {
  const lette = {
    1: seg('1', { stato: 'working' }),
    2: seg('2', { priorita: 3 }),
    3: seg('3', { locale: true }),
    4: seg('4', { stato: '' }),
    5: seg('5', { attese: Array.from({ length: 20 }, (_, i) => ({ id: `w${i}`, num: String(100 + i) })) }),
  };
  const r = await conRete({ lette }, () => SCRIPT.main(['t', 'spec', '--non-locale', '--pacchetto', '1,2,3,4,5,6']));
  assert.equal(r.code, 3);
  assert.equal(r.submit.length, 0, 'non si apre niente');
  const testo = r.err.join('\n');
  for (const atteso of [/#1 è «working»/, /#2 ha priorità 3/, /#3 è un lavoro locale/, /#4: lo stato non si legge/, /#5 aspetta già 20/, /#6: nessun feedback #6/]) {
    assert.match(testo, atteso);
  }
});

test('una segnalazione che il pacchetto stesso aspetta non si unisce: si aspetterebbero a vicenda', () => {
  assert.deepEqual(SCRIPT.controllaUnite([seg('7')], { aspetta: ['7'] }), ['#7 è anche fra quelli che il pacchetto aspetta: si aspetterebbero a vicenda']);
  assert.deepEqual(SCRIPT.controllaUnite([seg('7')]), []);
  assert.equal(SCRIPT.prioritaDelPacchetto(0, [seg('1', { priorita: 2 })]), 0, 'una priorità scelta vale');
  assert.equal(SCRIPT.prioritaDelPacchetto(null, [seg('1', { priorita: null })]), null);
});

test('un\'attesa che non si scrive non è silenziosa: il pacchetto c\'è, e la riga per rimediare è intera', async () => {
  const r = await conRete({
    lette: { 812: seg('812', { attese: [{ id: 'x', num: '700' }] }), 815: seg('815') },
    attendi: async (id) => (id === 'id812' ? { ok: false, motivo: 'scrittura fallita (503)' } : { ok: true }),
  }, () => SCRIPT.main(['t', 'spec', '--non-locale', '--pacchetto', '812 815']));
  assert.equal(r.code, 3);
  assert.match(r.err.join('\n'), /ATTESA NON SCRITTA su #812 \(scrittura fallita \(503\)\).*npm run feedback -- 812 --aspetta 700,900/);
  assert.match(r.out.join('\n'), /#815 lo aspetta/);
});

test('--pacchetto senza numeri, o con numeri storti, è un errore d\'uso; a vuoto non tocca la rete', async () => {
  const vuoto = await conRete({ lette: {} }, () => SCRIPT.main(['t', 'spec', '--non-locale', '--pacchetto']));
  assert.equal(vuoto.code, 1);
  assert.match(vuoto.err.join('\n'), /--pacchetto vuole un valore/);
  const storto = await conRete({ lette: {} }, () => SCRIPT.main(['t', 'spec', '--non-locale', '--pacchetto', 'menu']));
  assert.equal(storto.code, 1);
  assert.match(storto.err.join('\n'), /«menu» non è un numero di feedback/);
  const prova = await conRete({ lette: {} }, () => SCRIPT.main(['t', 'spec', '--non-locale', '--pacchetto', '812,815', '--dry-run']));
  assert.equal(prova.code, 0);
  assert.equal(prova.submit.length, 0);
  assert.match(prova.out.join('\n'), /come pacchetto che unisce #812, #815/);
});

test('submit scrive `unisce` solo col token admin, nella forma delle attese', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../../src/shared/feedback.js', import.meta.url), 'utf8');
  assert.match(src, /if \(unite\.length\) doc\.fields\.unisce = toFsValue\(unite\)/);
  const regole = (await import('node:fs')).readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  assert.match(regole, /&& unisceValido\(request\.resource\.data\)/, 'le regole controllano la forma alla nascita');
});
