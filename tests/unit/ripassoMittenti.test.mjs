// Il ripasso della prova del mittente (#595, #908): owner e sessioni per epoca, routine e costruzione solo con un
// segno che un falso non può avere, mai i segnalati (anche quelli fermi nei Ricevuti). Puro.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mod = await import(pathToFileURL(join(ROOT, 'scripts', 'ripasso-mittenti.mjs')).href);
const { VIA, MOTIVO } = mod;

const T = (s) => `2026-${s}Z`;
const doc = (id, clientId, status, createTime, senderProof = '', extra = {}) => ({ id, seq: 1, subSeq: 0, clientId, status, createTime, senderProof, ...extra });
const esitoDi = (r, id) => {
  const p = r.promossi.find((d) => d.id === id);
  return p ? `${p.prova}|${p.via}` : null;
};
const saltati = (r) => Object.fromEntries(r.saltati.map((s) => [`${s.categoria}|${s.motivo}`, s.n]));

test('la soglia è il primo feedback con la prova admin, altrimenti adesso', () => {
  const adesso = Date.parse(T('10-01T12:00:00'));
  assert.equal(mod.sogliaDellaProva([doc('a', 'local:claude', 'todo', T('09-01T00:00:00'))], adesso), adesso);
  const conProva = [
    doc('p2', 'local:claude', 'todo', T('10-03T00:00:00'), 'admin'),
    doc('p1', 'owner:me', 'todo', T('10-02T00:00:00'), 'admin'),
    doc('s', 'routine:x', 'todo', T('09-20T00:00:00'), 'server'),
  ];
  assert.equal(mod.sogliaDellaProva(conProva, Date.parse(T('10-09T00:00:00'))), Date.parse(T('10-02T00:00:00')));
});

test('owner e sessioni: admin se nati prima della soglia, mai segnalati né illeggibili', () => {
  const soglia = Date.parse(T('10-02T00:00:00'));
  const docs = [
    doc('vecchio-locale', 'local:claude', 'todo', T('09-29T00:00:00')),
    doc('vecchio-owner', 'owner:abc', 'design', T('09-10T00:00:00')),
    doc('falso-dopo', 'local:claude', 'todo', T('10-05T00:00:00')),
    doc('attacco', 'local:claude', 'attack', T('09-01T00:00:00')),
    doc('confermato', 'owner:abc', 'spam_confirmed', T('09-01T00:00:00')),
    doc('illeggibile', 'owner:abc', 'FENC1:zz', T('09-01T00:00:00')),
    doc('utente', 'c-123', 'todo', T('09-01T00:00:00')),
    doc('gia', 'local:claude', 'todo', T('09-01T00:00:00'), 'admin'),
    doc('senza-ora', 'local:claude', 'todo', ''),
  ];
  const r = mod.candidatiAlRipasso(docs, soglia);
  assert.deepEqual(r.promossi.map((d) => d.id), ['vecchio-locale', 'vecchio-owner']);
  assert.ok(r.promossi.every((d) => d.prova === 'admin' && d.via === VIA.EPOCA));
  const s = saltati(r);
  assert.equal(s[`local|${MOTIVO.DOPO}`], 2);
  assert.equal(s[`local|${MOTIVO.SEGNALATI}`], 1);
  assert.equal(s[`owner|${MOTIVO.SEGNALATI}`], 1, 'anche i *_confirmed restano fuori');
  assert.equal(s[`owner|${MOTIVO.ILLEGGIBILE}`], 1);
  assert.ok(!Object.keys(s).some((k) => k.startsWith('c-123')), 'un utente non entra nemmeno nei conti');
});

test('fermi nei Ricevuti: fuori se un giudice ha gridato attacco o spam, o se il giudizio non si legge', () => {
  const soglia = Date.parse(T('10-02T00:00:00'));
  const nato = T('09-01T00:00:00');
  const docs = [
    doc('voto-attacco', 'local:claude', 'unlabeled', nato, '', { pipeline: { verdicts: [{ class: 'aligned' }, { class: 'attack' }] } }),
    doc('blocco-spam', 'owner:me', 'unlabeled', nato, '', { pipeline: { action: 'block_spam', verdicts: [] } }),
    doc('l1', 'routine:verifier', 'unlabeled', nato, '', { pipeline: { l1Category: 'dangerous' }, derived: true }),
    doc('cifrato', 'local:claude', 'unlabeled', nato, '', { pipeline: 'illeggibile' }),
    doc('mai-giudicato', 'local:claude', 'unlabeled', nato),
    doc('design', 'local:claude', 'unlabeled', nato, '', { pipeline: { verdicts: [{ class: 'design' }] } }),
    doc('approvato-dopo-un-voto', 'local:claude', 'todo', nato, '', { pipeline: { verdicts: [{ class: 'attack' }] } }),
  ];
  const r = mod.candidatiAlRipasso(docs, soglia);
  assert.deepEqual(r.promossi.map((d) => d.id).sort(), ['approvato-dopo-un-voto', 'design', 'mai-giudicato']);
  const s = saltati(r);
  assert.equal(s[`local|${MOTIVO.RICEVUTI_SEGNALATI}`], 1);
  assert.equal(s[`owner|${MOTIVO.RICEVUTI_SEGNALATI}`], 1);
  assert.equal(s[`routine:verifier|${MOTIVO.RICEVUTI_SEGNALATI}`], 1, 'i campi del server non salvano un segnalato');
  assert.equal(s[`local|${MOTIVO.GIUDIZIO_ILLEGGIBILE}`], 1);
});

test('routine: la prova server solo con un segno del server, mai sul prefisso', () => {
  const soglia = Date.parse(T('10-02T00:00:00'));
  const nato = T('09-01T00:00:00');
  const docs = [
    doc('derivato', 'routine:residuo', 'todo', nato, '', { derived: true }),
    doc('generazione', 'routine:residuo', 'todo', nato, '', { generation: 2 }),
    doc('allarme', 'agent:costruzione', 'todo', nato, '', { alarmKeys: true }),
    doc('allarme-vecchio', 'agent:costruzione', 'todo', nato),
    doc('solo-prefisso', 'routine:verifier', 'todo', nato),
    doc('esploratore', 'agent:gemma-3', 'archived', nato),
  ];
  const r = mod.candidatiAlRipasso(docs, soglia);
  assert.equal(esitoDi(r, 'derivato'), `server|${VIA.CAMPI}`);
  assert.equal(esitoDi(r, 'generazione'), `server|${VIA.CAMPI}`);
  assert.equal(esitoDi(r, 'allarme'), `server|${VIA.CAMPI}`);
  const s = saltati(r);
  assert.equal(s[`agent:costruzione|${MOTIVO.SENZA_SEGNO}`], 1);
  assert.equal(s[`routine:verifier|${MOTIVO.SENZA_SEGNO}`], 1);
  assert.equal(s[`agent (esploratore)|${MOTIVO.ESPLORATORE}`], 1);
});

test('coda di triage: per uid col mittente giusto, per titolo solo se unico e nei tempi', () => {
  const soglia = Date.parse(T('10-02T00:00:00'));
  const coda = mod.vociDellaCoda([
    { op: 'create', uid: 'u-1', queuedBy: 'prober', name: 'x' },
    { op: 'create', uid: 'u-2', queuedBy: 'prober', name: 'y' },
    { op: 'create', name: 'Vecchio', queuedBy: 'routine', queuedAt: T('06-12T10:00:00') },
    { op: 'create', name: 'Vecchio', queuedBy: 'routine', queuedAt: T('06-12T10:00:00') },
    { op: 'create', name: 'Doppio', queuedBy: 'routine', queuedAt: T('06-13T10:00:00') },
    { op: 'create', name: 'Tardi', queuedBy: 'routine', queuedAt: T('06-14T10:00:00') },
    { id: 'u-9', op: 'update', status: 'done' },
  ]);
  const docs = [
    doc('u-1', 'routine:prober', 'done', T('07-10T00:00:00')),
    doc('u-2', 'routine:verifier', 'done', T('07-10T00:00:00')),
    doc('auto-1', 'routine:routine', 'done', T('06-12T10:02:00'), '', { name: 'Vecchio' }),
    doc('auto-2', 'routine:routine', 'done', T('06-13T10:02:00'), '', { name: 'Doppio' }),
    doc('auto-3', 'routine:routine', 'archived', T('06-13T10:03:00'), '', { name: 'Doppio' }),
    doc('auto-4', 'routine:routine', 'done', T('06-20T10:00:00'), '', { name: 'Tardi' }),
    doc('u-9', 'routine:routine', 'done', T('06-20T10:00:00')),
  ];
  const r = mod.candidatiAlRipasso(docs, soglia, { coda });
  assert.equal(esitoDi(r, 'u-1'), `server|${VIA.CODA_ID}`);
  assert.equal(esitoDi(r, 'u-2'), null, 'la uid di una voce con un altro mittente non prova niente');
  assert.equal(esitoDi(r, 'auto-1'), `server|${VIA.CODA_TITOLO}`, 'la stessa voce su due rami conta una volta');
  assert.equal(esitoDi(r, 'auto-2'), null, 'due documenti con lo stesso titolo: uno può essere un falso');
  assert.equal(esitoDi(r, 'auto-4'), null, 'fuori dalla finestra della Action');
  assert.equal(esitoDi(r, 'u-9'), null, 'una voce di aggiornamento non crea niente');
  const s = saltati(r);
  assert.equal(s[`routine:routine|${MOTIVO.CODA_AMBIGUA}`], 3);
  assert.equal(s[`routine:verifier|${MOTIVO.SENZA_SEGNO}`], 1);
});

test('derivati: la nota del server sul padre prova il numero, se il numero è unico', () => {
  const soglia = Date.parse(T('10-02T00:00:00'));
  const nato = T('09-10T00:00:00');
  const docs = [
    doc('padre', 'owner:me', 'done', T('09-01T00:00:00'), 'admin', { seq: 500 }),
    doc('d1', 'routine:residuo', 'todo', nato, '', { seq: 500, subSeq: 1, parentId: 'padre' }),
    doc('d2', 'routine:residuo', 'todo', nato, '', { seq: 500, subSeq: 2, parentId: 'padre' }),
    doc('d2-doppio', 'routine:residuo', 'todo', nato, '', { seq: 500, subSeq: 2, parentId: 'padre' }),
    doc('d3', 'routine:residuo', 'todo', nato, '', { seq: 500, subSeq: 3, parentId: 'padre' }),
  ];
  const derivatiDelPadre = new Map([['padre', mod.numeriDerivatiNelleNote('x\nFeedback derivati aperti: #500.1 (priorità 2, esterno), #500.2 (priorità 1, rimasti).')]]);
  const r = mod.candidatiAlRipasso(docs, soglia, { derivatiDelPadre });
  assert.equal(esitoDi(r, 'd1'), `server|${VIA.NOTA_PADRE}`);
  assert.equal(esitoDi(r, 'd2'), null);
  assert.equal(esitoDi(r, 'd3'), null);
  assert.equal(saltati(r)[`routine:residuo|${MOTIVO.DERIVATO_SENZA_NOTA}`], 3);
});

test('le frasi del server sui derivati, nelle tre forme che ha avuto', () => {
  const note = [
    'Verifica: ancora migliorabile dopo 3 giri — avanti. I rilievi non risolti sono diventati il feedback #12.1 (rilievo residuo). critica',
    'I rilievi non corretti sono diventati il feedback #12.2.',
    'Feedback derivato aperto: #12.3 (priorità 2, interno messo da parte).',
    'Un messaggio che cita #12.9 senza la frase del server.',
  ].join('\r\n');
  assert.deepEqual([...mod.numeriDerivatiNelleNote(note)].sort(), ['#12.1', '#12.2', '#12.3']);
  assert.equal(mod.numeriDerivatiNelleNote('').size, 0);
});

test('i padri da leggere: solo per i derivati senza segno, mai di un segnalato o di uno nei Ricevuti', () => {
  const docs = [
    doc('p-ok', 'owner:me', 'done', T('09-01T00:00:00')),
    doc('p-attacco', 'c-1', 'attack', T('09-01T00:00:00')),
    doc('p-ricevuti', 'c-2', 'unlabeled', T('09-01T00:00:00')),
    doc('a', 'routine:residuo', 'todo', T('09-02T00:00:00'), '', { parentId: 'p-ok' }),
    doc('b', 'routine:residuo', 'todo', T('09-02T00:00:00'), '', { parentId: 'p-attacco' }),
    doc('c', 'routine:residuo', 'todo', T('09-02T00:00:00'), '', { parentId: 'p-ricevuti' }),
    doc('d', 'routine:residuo', 'todo', T('09-02T00:00:00'), '', { parentId: 'p-altro', derived: true }),
    doc('e', 'routine:residuo', 'todo', T('09-02T00:00:00'), 'server', { parentId: 'p-altro' }),
  ];
  assert.deepEqual(mod.padriDaLeggere(docs), ['p-ok']);
});

test('la coda si legge da git: percorsi delle voci e uscita di cat-file', () => {
  const log = '@aaa\n\nfeedback-triage/u-1.json\nfeedback-triage/claims/x.json\nfeedback-triage/README.md\n@bbb\n\nfeedback-triage/u-2.json\n';
  assert.deepEqual(mod.percorsiDellaCoda(log), ['aaa:feedback-triage/u-1.json', 'bbb:feedback-triage/u-2.json']);
  const a = JSON.stringify({ op: 'create', uid: 'u-1' });
  const out = Buffer.from(`1111 blob ${Buffer.byteLength(a)}\n${a}\nbbb:x missing\n2222 blob 3\n{x\n`);
  assert.deepEqual(mod.vociDalBatch(out), [{ op: 'create', uid: 'u-1' }]);
});

test('famiglie del mittente per i conti', () => {
  assert.equal(mod.categoria('owner:caf'), 'owner');
  assert.equal(mod.categoria('LOCAL:claude'), 'local');
  assert.equal(mod.categoria('routine:owner:sessione-locale'), 'routine:owner');
  assert.equal(mod.categoria('agent:costruzione'), 'agent:costruzione');
  assert.equal(mod.categoria('agent:gemini-3.1'), 'agent (esploratore)');
  assert.equal(mod.categoria('c-123'), '');
  const righe = mod.resoconto({
    promossi: [{ categoria: 'owner', prova: 'admin', via: VIA.EPOCA }],
    saltati: [{ categoria: 'local', motivo: MOTIVO.DOPO, n: 2 }],
  });
  assert.deepEqual(righe, ['Ricevono la prova: 1', `  owner: 1 → admin (${VIA.EPOCA})`, 'Restano senza: 2', `  local: 2 (${MOTIVO.DOPO})`]);
});
