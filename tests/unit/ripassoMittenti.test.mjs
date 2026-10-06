// Il ripasso della prova del mittente (#595, #908, #912): routine e costruzione solo con un segno che un falso non può
// avere, mai i segnalati (anche quelli fermi nei Ricevuti); owner e sessioni mai, il solo nome non è una prova. Puro.

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
const cand = (docs, extra = {}) => mod.candidatiAlRipasso(docs, extra);

// #912, decisione dell'owner del 02/10/2026: owner e sessioni firmano con la credenziale, e il suo Filo la scrive.
test('owner e sessioni senza prova: il ripasso non gliela dà mai, per vecchi che siano', () => {
  const docs = [
    doc('vecchio-locale', 'local:claude', 'todo', T('06-16T00:00:00')),
    doc('vecchio-owner', 'owner:abc', 'design', T('05-10T00:00:00')),
    doc('recente', 'LOCAL:claude', 'todo', T('10-05T00:00:00')),
    doc('senza-ora', 'owner:abc', 'todo', ''),
    doc('attacco', 'local:claude', 'attack', T('09-01T00:00:00')),
    doc('confermato', 'owner:abc', 'spam_confirmed', T('09-01T00:00:00')),
    doc('illeggibile', 'owner:abc', 'FENC1:zz', T('09-01T00:00:00')),
    doc('utente', 'c-123', 'todo', T('09-01T00:00:00')),
    doc('gia', 'local:claude', 'todo', T('09-01T00:00:00'), 'admin'),
  ];
  const r = cand(docs);
  assert.deepEqual(r.promossi, []);
  const s = saltati(r);
  assert.equal(s[`local|${MOTIVO.SOLO_NOME}`], 2);
  assert.equal(s[`owner|${MOTIVO.SOLO_NOME}`], 2);
  assert.equal(s[`local|${MOTIVO.SEGNALATI}`], 1);
  assert.equal(s[`owner|${MOTIVO.SEGNALATI}`], 1, 'anche i *_confirmed restano fuori');
  assert.equal(s[`owner|${MOTIVO.ILLEGGIBILE}`], 1);
  assert.ok(!Object.keys(s).some((k) => k.startsWith('c-123')), 'un utente non entra nemmeno nei conti');
  assert.ok(!('EPOCA' in VIA), 'nessuna strada per epoca');
});

test('fermi nei Ricevuti: fuori se un giudice ha gridato attacco o spam, o se il giudizio non si legge', () => {
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
  const r = cand(docs);
  assert.deepEqual(r.promossi, []);
  const s = saltati(r);
  assert.equal(s[`local|${MOTIVO.SOLO_NOME}`], 3, 'i non segnalati restano senza per il solo nome');
  assert.equal(s[`local|${MOTIVO.RICEVUTI_SEGNALATI}`], 1);
  assert.equal(s[`owner|${MOTIVO.RICEVUTI_SEGNALATI}`], 1);
  assert.equal(s[`routine:verifier|${MOTIVO.RICEVUTI_SEGNALATI}`], 1, 'i campi del server non salvano un segnalato');
  assert.equal(s[`local|${MOTIVO.GIUDIZIO_ILLEGGIBILE}`], 1);
});

test('routine: la prova server solo con un segno del server, mai sul prefisso', () => {
  const nato = T('09-01T00:00:00');
  const docs = [
    doc('derivato', 'routine:residuo', 'todo', nato, '', { derived: true }),
    doc('generazione', 'routine:residuo', 'todo', nato, '', { generation: 2 }),
    doc('allarme', 'agent:costruzione', 'todo', nato, '', { alarmKeys: true }),
    doc('allarme-vecchio', 'agent:costruzione', 'todo', nato),
    doc('solo-prefisso', 'routine:verifier', 'todo', nato),
    doc('esploratore', 'agent:gemma-3', 'archived', nato),
  ];
  const r = cand(docs);
  assert.equal(esitoDi(r, 'derivato'), `server|${VIA.CAMPI}`);
  assert.equal(esitoDi(r, 'generazione'), `server|${VIA.CAMPI}`);
  assert.equal(esitoDi(r, 'allarme'), `server|${VIA.CAMPI}`);
  const s = saltati(r);
  assert.equal(s[`agent:costruzione|${MOTIVO.SENZA_SEGNO}`], 1);
  assert.equal(s[`routine:verifier|${MOTIVO.SENZA_SEGNO}`], 1);
  assert.equal(s[`agent (esploratore)|${MOTIVO.ESPLORATORE}`], 1);
});

test('coda di triage: per uid col mittente giusto e nei tempi, per titolo solo se unico e nei tempi', () => {
  const coda = mod.vociDellaCoda([
    { op: 'create', uid: 'u-1', queuedBy: 'prober', name: 'x', queuedAt: T('07-09T23:55:00') },
    { op: 'create', uid: 'u-2', queuedBy: 'prober', name: 'y', queuedAt: T('07-09T23:55:00') },
    { op: 'create', uid: 'u-pubblica', queuedBy: 'routine', name: 'z', queuedAt: T('06-12T10:00:00') },
    { op: 'create', uid: 'u-rami', queuedBy: 'routine', name: 'w', queuedAt: T('06-15T10:00:00') },
    { op: 'create', uid: 'u-rami', queuedBy: 'routine', name: 'w', queuedAt: T('06-12T10:00:00') },
    { op: 'create', uid: 'u-rami', queuedBy: 'routine', name: 'w' },
    { op: 'create', uid: 'u-senza-ora', queuedBy: 'routine', name: 'v' },
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
    doc('u-pubblica', 'routine:routine', 'todo', T('09-30T08:00:00')),
    doc('u-rami', 'routine:routine', 'done', T('06-12T11:00:00')),
    doc('u-senza-ora', 'routine:routine', 'done', T('06-12T11:00:00')),
  ];
  const r = cand(docs, { coda });
  assert.equal(esitoDi(r, 'u-1'), `server|${VIA.CODA_ID}`);
  assert.equal(esitoDi(r, 'u-pubblica'), null, 'un id preso dalla storia pubblica, nato mesi dopo l\'accodamento');
  assert.equal(esitoDi(r, 'u-rami'), `server|${VIA.CODA_ID}`, 'la stessa voce su più rami vale col suo accodamento più vecchio');
  assert.equal(esitoDi(r, 'u-senza-ora'), null, 'senza l\'ora dell\'accodamento non si sa se è nato nei tempi');
  assert.equal(esitoDi(r, 'u-2'), null, 'la uid di una voce con un altro mittente non prova niente');
  assert.equal(esitoDi(r, 'auto-1'), `server|${VIA.CODA_TITOLO}`, 'la stessa voce su due rami conta una volta');
  assert.equal(esitoDi(r, 'auto-2'), null, 'due documenti con lo stesso titolo: uno può essere un falso');
  assert.equal(esitoDi(r, 'auto-4'), null, 'fuori dalla finestra della Action');
  assert.equal(esitoDi(r, 'u-9'), null, 'una voce di aggiornamento non crea niente');
  const s = saltati(r);
  assert.equal(s[`routine:routine|${MOTIVO.CODA_AMBIGUA}`], 3);
  assert.equal(s[`routine:routine|${MOTIVO.CODA_FUORI_TEMPO}`], 2);
  assert.equal(s[`routine:verifier|${MOTIVO.SENZA_SEGNO}`], 1);
});

test('derivati: la nota del server sul padre prova il numero, se il numero è unico', () => {
  const nato = T('09-10T00:00:00');
  const docs = [
    doc('padre', 'owner:me', 'done', T('09-01T00:00:00'), 'admin', { seq: 500 }),
    doc('d1', 'routine:residuo', 'todo', nato, '', { seq: 500, subSeq: 1, parentId: 'padre' }),
    doc('d2', 'routine:residuo', 'todo', nato, '', { seq: 500, subSeq: 2, parentId: 'padre' }),
    doc('d2-doppio', 'routine:residuo', 'todo', nato, '', { seq: 500, subSeq: 2, parentId: 'padre' }),
    doc('d3', 'routine:residuo', 'todo', nato, '', { seq: 500, subSeq: 3, parentId: 'padre' }),
  ];
  const derivatiDelPadre = new Map([['padre', mod.numeriDerivatiNelleNote('x\nFeedback derivati aperti: #500.1 (priorità 2, esterno), #500.2 (priorità 1, rimasti).')]]);
  const r = cand(docs, { derivatiDelPadre });
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
    promossi: [{ categoria: 'routine:residuo', prova: 'server', via: VIA.CAMPI }],
    saltati: [{ categoria: 'local', motivo: MOTIVO.SOLO_NOME, n: 2 }],
  });
  assert.deepEqual(righe, ['Ricevono la prova: 1', `  routine:residuo: 1 → server (${VIA.CAMPI})`, 'Restano senza: 2', `  local: 2 (${MOTIVO.SOLO_NOME})`]);
});

test('il giro scrive solo le prove del server, e a vuoto niente', async () => {
  const docs = [
    doc('vecchio', 'local:claude', 'todo', T('06-16T00:00:00')),
    doc('o', 'owner:me', 'todo', T('07-01T00:00:00')),
    doc('derivato', 'routine:residuo', 'todo', T('07-01T00:00:00'), '', { derived: true }),
  ];
  const base = { docs, coda: mod.vociDellaCoda([]), derivatiDelPadre: new Map(), log: () => {}, err: () => {} };
  const traccia = [];
  const scrivi = (esito = { ok: true }) => ({ prova: async (d) => { traccia.push([d.id, d.prova]); return esito; } });
  assert.equal(await mod.eseguiGiro({ ...base, dryRun: false, scrivi: scrivi() }), 0);
  assert.deepEqual(traccia, [['derivato', 'server']]);

  traccia.length = 0;
  assert.equal(await mod.eseguiGiro({ ...base, dryRun: true, scrivi: scrivi() }), 0);
  assert.deepEqual(traccia, [], 'a vuoto non si scrive');

  traccia.length = 0;
  assert.equal(await mod.eseguiGiro({ ...base, dryRun: false, scrivi: scrivi({ ok: false, status: 403 }) }), 3);
});

test('lavori locali passati: il ramo fuso dalla strada locale e una pratica provata dell’owner o di una sessione', () => {
  const rami = mod.ramiFusiInLocale([
    'finish: claude/dashboard-viva via server',
    'finish: claude/lavori-locali via server (lavoro locale 910, L5 registrato)',
    'finish: worker/abc-123 via server (approvazione dell’owner)',
    'merge: claude/altro',
  ].join('\n'));
  assert.deepEqual([...rami].sort(), ['claude/dashboard-viva', 'claude/lavori-locali']);
  const docs = [
    doc('fatto', 'local:claude', 'done', T('09-01T00:00:00'), 'admin', { branch: 'claude/dashboard-viva' }),
    doc('owner', 'owner:me', 'archived', T('09-01T00:00:00'), 'admin', { branch: 'claude/lavori-locali' }),
    doc('gia-segnato', 'local:claude', 'done', T('09-01T00:00:00'), 'admin', { branch: 'claude/dashboard-viva', localOnly: true }),
    doc('routine', 'routine:worker', 'done', T('09-01T00:00:00'), 'server', { branch: 'claude/dashboard-viva' }),
    doc('ramo-routine', 'local:claude', 'done', T('09-01T00:00:00'), 'admin', { branch: 'worker/abc-123' }),
    doc('senza-prova', 'local:claude', 'done', T('09-01T00:00:00'), '', { branch: 'claude/dashboard-viva' }),
    doc('attacco', 'local:claude', 'attack_confirmed', T('09-01T00:00:00'), 'admin', { branch: 'claude/dashboard-viva' }),
  ];
  assert.deepEqual(mod.lavoriLocaliPassati(docs, rami).map((d) => d.id), ['fatto', 'owner']);
});

test('il giro segna i lavori locali passati dopo le prove, e a vuoto li elenca soltanto', async () => {
  const docs = [doc('l', 'local:claude', 'done', T('09-01T00:00:00'), 'admin', { branch: 'claude/x', seq: 544 })];
  const rami = new Set(['claude/x']);
  const righe = [];
  const traccia = [];
  const scrivi = { prova: async () => ({ ok: true }), locale: async (d) => { traccia.push(d.id); return { ok: true }; } };
  const base = { docs, coda: mod.vociDellaCoda([]), derivatiDelPadre: new Map(), rami, scrivi, err: () => {} };
  assert.equal(await mod.eseguiGiro({ ...base, dryRun: true, log: (r) => righe.push(r) }), 0);
  assert.ok(righe.some((r) => /Lavori locali passati da segnare.*: 1 \(#544\)/.test(r)), righe.join('\n'));
  assert.deepEqual(traccia, []);
  assert.equal(await mod.eseguiGiro({ ...base, dryRun: false, log: () => {} }), 0);
  assert.deepEqual(traccia, ['l']);
  const rifiuto = { ...scrivi, locale: async () => ({ ok: false, status: 403 }) };
  assert.equal(await mod.eseguiGiro({ ...base, dryRun: false, scrivi: rifiuto, log: () => {} }), 3);
});

// Giro 3 della verifica locale: la regola del lettore in ogni stato dei Ricevuti, non solo in «Non filtrato».
test('un giudice che dice attacco in un «allineato» o in un «design» tiene fuori dal ripasso come in «Non filtrato»', () => {
  const nato = T('09-20T00:00:00');
  const voto = (cls) => ({ verdicts: [{ judge: 'A', class: cls }, { judge: 'B', class: 'attack' }] });
  const r = cand([
    doc('al', 'local:claude', 'aligned', nato, '', { pipeline: voto('aligned') }),
    doc('de', 'owner:me', 'design', nato, '', { pipeline: voto('design') }),
    doc('ok', 'routine:residuo', 'aligned', nato, '', { derived: true, pipeline: { verdicts: [{ judge: 'A', class: 'aligned' }] } }),
  ]);
  assert.deepEqual(r.promossi.map((d) => d.id), ['ok']);
  const s = saltati(r);
  assert.equal(s[`local|${MOTIVO.RICEVUTI_SEGNALATI}`], 1);
  assert.equal(s[`owner|${MOTIVO.RICEVUTI_SEGNALATI}`], 1);
});

// Giro 4 della verifica locale: #507 e #714 il ramo lo nominavano solo nella conversazione.
test('lavori locali passati col ramo solo nella conversazione: chiusi, senza ramo scritto, ramo fuso in locale', async () => {
  const rami = new Set(['claude/routine-consegne', 'claude/rossi-windows']);
  assert.deepEqual([...mod.ramiNelleNote('Risolto in locale sul ramo claude/routine-consegne. Poi «claude/rossi-windows», fine.')].sort(),
    ['claude/rossi-windows', 'claude/routine-consegne']);
  const docs = [
    doc('507', 'local:claude', 'done', T('08-28T00:00:00'), 'admin', { seq: 507 }),
    doc('714', 'local:claude', 'done', T('09-20T00:00:00'), 'admin', { seq: 714 }),
    doc('aperto', 'local:claude', 'todo', T('09-20T00:00:00'), 'admin'),
    doc('routine-fix', 'owner:me', 'done', T('09-20T00:00:00'), 'admin', { branch: 'worker/abc' }),
    doc('nominato-non-fuso', 'local:claude', 'done', T('09-20T00:00:00'), 'admin'),
    doc('utente', 'c-tester', 'done', T('09-20T00:00:00')),
  ];
  assert.deepEqual(mod.noteDaLeggere(docs), ['507', '714', 'nominato-non-fuso'], 'solo chiusi, owner o sessione, senza ramo scritto');
  const note = new Map([
    ['507', new Set(['claude/routine-consegne'])], ['714', new Set(['claude/rossi-windows'])],
    ['aperto', new Set(['claude/rossi-windows'])], ['routine-fix', new Set(['claude/rossi-windows'])],
    ['nominato-non-fuso', new Set(['claude/mai-fuso'])],
  ]);
  assert.deepEqual(mod.lavoriLocaliPassati(docs, rami, note).map((d) => d.id), ['507', '714']);

  const righe = [];
  const chiesti = [];
  const base = {
    docs, coda: mod.vociDellaCoda([]), derivatiDelPadre: new Map(), rami,
    dryRun: true, err: () => {}, log: (r) => righe.push(r),
    scrivi: { prova: async () => ({ ok: true }), locale: async () => ({ ok: true }) },
    leggiNote: async (ids) => { chiesti.push(...ids); return note; },
  };
  assert.equal(await mod.eseguiGiro(base), 0);
  assert.deepEqual(chiesti, ['507', '714', 'nominato-non-fuso']);
  assert.ok(righe.some((r) => /Lavori locali passati da segnare.*: 2 \(#507 #714\)/.test(r)), righe.join('\n'));
  // Le conversazioni che non si leggono si dicono, e il resto del giro va avanti.
  const errori = [];
  assert.equal(await mod.eseguiGiro({ ...base, leggiNote: async () => { throw new Error('rete giù'); }, err: (r) => errori.push(r) }), 0);
  assert.match(errori.join('\n'), /conversazioni delle pratiche chiuse non si leggono/);
});
