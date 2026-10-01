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
const S = (ms) => ({ local: ms, owner: ms });
const msDi = (soglie) => Object.fromEntries(Object.entries(soglie).map(([f, v]) => [f, v.ms]));
// Chi crea scrive la prova da sempre: decide solo la soglia salvata (il caso «non ancora» ha i suoi test in fondo).
const DA_SEMPRE = { local: 0, owner: 0 };
const cand = (docs, soglie, extra = {}) => mod.candidatiAlRipasso(docs, soglie, { inizioProva: DA_SEMPRE, ...extra });

test('senza soglie salvate: per famiglia, il primo feedback nato con la prova, altrimenti adesso', () => {
  const adesso = Date.parse(T('10-09T00:00:00'));
  const vuote = mod.soglieDelRipasso([doc('a', 'local:claude', 'todo', T('09-01T00:00:00'))], {}, adesso);
  assert.deepEqual(vuote, { local: { ms: adesso, origine: 'adesso', doc: '' }, owner: { ms: adesso, origine: 'adesso', doc: '' } });
  const conProva = [
    doc('p2', 'local:claude', 'todo', T('10-03T00:00:00'), 'admin', { seq: 902 }),
    doc('p1', 'local:claude', 'todo', T('10-02T00:00:00'), 'admin', { seq: 901 }),
    doc('s', 'routine:x', 'todo', T('09-20T00:00:00'), 'server'),
  ];
  const s = mod.soglieDelRipasso(conProva, null, adesso);
  assert.deepEqual(s.local, { ms: Date.parse(T('10-02T00:00:00')), origine: 'documento', doc: '#901' });
  assert.deepEqual(s.owner, { ms: adesso, origine: 'adesso', doc: '' }, 'una sessione che parla per prima non sposta la soglia dell\'owner');
});

test('la soglia di una famiglia non è quella dell\'altra: l\'app vecchia dell\'owner resta coperta', () => {
  const adesso = Date.parse(T('10-09T00:00:00'));
  const docs = [
    doc('sessione', 'local:claude', 'todo', T('10-02T00:00:00'), 'admin'),
    doc('falso-locale', 'local:claude', 'todo', T('10-03T00:00:00')),
    doc('owner-app-vecchia', 'owner:me', 'todo', T('10-04T00:00:00')),
  ];
  const r = cand(docs, msDi(mod.soglieDelRipasso(docs, {}, adesso)));
  assert.equal(esitoDi(r, 'owner-app-vecchia'), `admin|${VIA.EPOCA}`);
  assert.equal(esitoDi(r, 'falso-locale'), null);
});

test('la soglia salvata dal primo giro vale ai giri dopo: un escluso accettato poi riceve la prova', () => {
  const primoGiro = Date.parse(T('10-01T12:00:00'));
  const voto = { pipeline: { verdicts: [{ class: 'attack' }] } };
  const docs = [
    doc('vecchio', 'local:claude', 'todo', T('06-16T00:00:00')),
    doc('fermo', 'local:claude', 'unlabeled', T('07-01T00:00:00'), '', voto),
    doc('owner-vecchio', 'owner:me', 'todo', T('08-01T00:00:00')),
  ];
  const s1 = mod.soglieDelRipasso(docs, {}, primoGiro);
  const r1 = cand(docs, msDi(s1));
  assert.deepEqual(r1.promossi.map((d) => d.id).sort(), ['owner-vecchio', 'vecchio']);
  // Il primo giro scrive le prove; l'owner accetta da Gestione quello fermo nei Ricevuti.
  const promossi = new Set(r1.promossi.map((d) => d.id));
  const dopo = docs.map((d) => (promossi.has(d.id) ? { ...d, senderProof: 'admin' } : d.id === 'fermo' ? { ...d, status: 'todo' } : d));
  const salvate = msDi(s1);
  const s2 = mod.soglieDelRipasso(dopo, salvate, Date.parse(T('10-20T00:00:00')));
  assert.deepEqual(s2.local, { ms: primoGiro, origine: 'salvata', doc: '' });
  assert.equal(esitoDi(cand(dopo, msDi(s2)), 'fermo'), `admin|${VIA.EPOCA}`);
  assert.equal(mod.soglieDelRipasso(dopo, {}, primoGiro).local.ms, Date.parse(T('06-16T00:00:00')),
    'ricalcolata dai documenti, la soglia cadrebbe sulle prove scritte dal ripasso stesso');
});

test('una soglia salvata illeggibile ferma il giro, non si ricalcola', () => {
  for (const male of ['2026-10-01', -5, 1.5, true]) {
    assert.throws(() => mod.soglieDelRipasso([], { local: male }, Date.now()), /soglia salvata per local/);
  }
  assert.equal(mod.soglieDelRipasso([], { owner: 1000 }, 5000).owner.origine, 'salvata');
});

test('senza soglia per la famiglia nessuno passa per epoca', () => {
  const r = cand([doc('a', 'owner:me', 'todo', T('09-01T00:00:00'))], { local: Date.now() });
  assert.equal(r.promossi.length, 0);
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
  const r = cand(docs, S(soglia));
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
  const r = cand(docs, S(soglia));
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
  const r = cand(docs, S(soglia));
  assert.equal(esitoDi(r, 'derivato'), `server|${VIA.CAMPI}`);
  assert.equal(esitoDi(r, 'generazione'), `server|${VIA.CAMPI}`);
  assert.equal(esitoDi(r, 'allarme'), `server|${VIA.CAMPI}`);
  const s = saltati(r);
  assert.equal(s[`agent:costruzione|${MOTIVO.SENZA_SEGNO}`], 1);
  assert.equal(s[`routine:verifier|${MOTIVO.SENZA_SEGNO}`], 1);
  assert.equal(s[`agent (esploratore)|${MOTIVO.ESPLORATORE}`], 1);
});

test('coda di triage: per uid col mittente giusto e nei tempi, per titolo solo se unico e nei tempi', () => {
  const soglia = Date.parse(T('10-02T00:00:00'));
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
  const r = cand(docs, S(soglia), { coda });
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
  const r = cand(docs, S(soglia), { derivatiDelPadre });
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

test('il giro salva le soglie nuove prima di ogni prova, e se non le salva non scrive niente', async () => {
  const adesso = Date.parse(T('10-01T12:00:00'));
  const docs = [doc('vecchio', 'local:claude', 'todo', T('06-16T00:00:00')), doc('o', 'owner:me', 'todo', T('07-01T00:00:00'))];
  const base = { docs, adesso, coda: mod.vociDellaCoda([]), derivatiDelPadre: new Map(), inizioProva: DA_SEMPRE, log: () => {}, err: () => {} };
  const traccia = [];
  const scrivi = (esitoSoglie = { ok: true }) => ({
    soglie: async (n) => { traccia.push(['soglie', n]); return esitoSoglie; },
    prova: async (d) => { traccia.push(['prova', d.id]); return { ok: true }; },
  });
  assert.equal(await mod.eseguiGiro({ ...base, salvate: {}, dryRun: false, scrivi: scrivi() }), 0);
  assert.deepEqual(traccia.map((x) => x[0]), ['soglie', 'prova', 'prova']);
  assert.deepEqual(traccia[0][1], { local: adesso, owner: adesso });

  traccia.length = 0;
  assert.equal(await mod.eseguiGiro({ ...base, salvate: {}, dryRun: false, scrivi: scrivi({ ok: false, status: 403 }) }), 3);
  assert.deepEqual(traccia.map((x) => x[0]), ['soglie'], 'senza le soglie salvate nessuna prova');

  traccia.length = 0;
  assert.equal(await mod.eseguiGiro({ ...base, salvate: {}, dryRun: true, scrivi: scrivi() }), 0);
  assert.deepEqual(traccia, [], 'a vuoto non si scrivono nemmeno le soglie');

  traccia.length = 0;
  await mod.eseguiGiro({ ...base, salvate: { local: adesso }, dryRun: false, scrivi: scrivi() });
  assert.deepEqual(traccia[0], ['soglie', { owner: adesso }], 'si scrive solo la famiglia che non l\'aveva');
  traccia.length = 0;
  await mod.eseguiGiro({ ...base, salvate: { local: adesso, owner: adesso }, dryRun: false, scrivi: scrivi() });
  assert.ok(!traccia.some((x) => x[0] === 'soglie'), 'una soglia salvata non si riscrive');
});

test('le soglie stanno in un documento che solo l\'admin legge e scrive', async () => {
  const { readFileSync } = await import('node:fs');
  const regole = readFileSync(join(ROOT, 'firestore.rules'), 'utf8').replace(/\/\/[^\n]*/g, '');
  const m = new RegExp(`match /${mod.DOVE_SOGLIE.doc.replace('/', '\/')} \{([^}]*)\}`).exec(regole);
  assert.ok(m, `firestore.rules: blocco di ${mod.DOVE_SOGLIE.doc} non trovato`);
  const allow = [...m[1].matchAll(/allow\s+([a-z,\s]+?)\s*:\s*if\s+([^;]+);/g)].map((x) => [x[1].trim(), x[2].trim()]);
  assert.deepEqual(allow, [['read', 'isAdmin()'], ['write', 'isAdmin()']], 'chi sposta la soglia fa passare i falsi');
});

test('la soglia salvata non vale finché chi crea non scrive la prova: l’owner dal Filo installato e le sessioni da main', () => {
  // Il primo giro vero l'ha fissata il 01/10 alle 11:16, quando la prova la scriveva solo il ramo del lavoro.
  const salvata = S(Date.parse(T('10-01T11:16:00')));
  const docs = [
    doc('owner-oggi', 'owner:caf', 'unlabeled', T('10-01T15:00:00')),
    doc('sessione-oggi', 'local:claude', 'todo', T('10-01T15:05:00')),
    doc('segnalato-oggi', 'local:claude', 'unlabeled', T('10-01T15:10:00'), '', { pipeline: { verdicts: [{ class: 'attack' }] } }),
  ];
  const nonAncora = mod.candidatiAlRipasso(docs, salvata, { inizioProva: { local: Infinity, owner: Infinity } });
  assert.deepEqual(nonAncora.promossi.map((d) => d.id).sort(), ['owner-oggi', 'sessione-oggi']);
  assert.equal(saltati(nonAncora)[`local|${MOTIVO.RICEVUTI_SEGNALATI}`], 1, 'i segnalati restano fuori comunque');
  // Main la scrive dal 02/10 per le sessioni, la versione pubblicata dal 03/10 per l'owner.
  const inizio = { local: Date.parse(T('10-02T09:00:00')), owner: Date.parse(T('10-03T09:00:00')) };
  const dopo = [...docs,
    doc('owner-app-nuova', 'owner:caf', 'todo', T('10-03T10:00:00')),
    doc('sessione-ramo-vecchio', 'local:claude', 'todo', T('10-02T10:00:00')),
    doc('owner-app-vecchia', 'owner:caf', 'todo', T('10-02T10:00:00'))];
  const r = mod.candidatiAlRipasso(dopo, salvata, { inizioProva: inizio });
  assert.deepEqual(r.promossi.map((d) => d.id).sort(), ['owner-app-vecchia', 'owner-oggi', 'sessione-oggi']);
  assert.equal(saltati(r)[`owner|${MOTIVO.DOPO}`], 1);
  assert.equal(saltati(r)[`local|${MOTIVO.DOPO}`], 1, 'dopo l’arrivo su main, senza prova si riconosce in Gestione');
});

test('da quando chi crea scrive la prova: dall’arrivo su main (sessioni) e dalla prima versione che la porta (owner)', () => {
  const git = (risposte) => (args) => {
    const chiave = args[0] === 'log' ? `log ${args[args.length - 1]}` : args[0];
    if (!(chiave in risposte)) throw new Error('niente');
    return risposte[chiave];
  };
  assert.deepEqual(mod.inizioDellaProva(git({})), { local: Infinity, owner: Infinity }, 'main non la scrive: non ancora');
  const suMain = {
    'log scripts/claude-feedback.mjs': 'aaa 2026-10-02T09:00:00+02:00\nbbb 2026-10-05T09:00:00+02:00\n',
    'log src/shared/feedback.js': 'ccc 2026-10-02T09:00:00+02:00\n',
  };
  assert.deepEqual(mod.inizioDellaProva(git(suMain)), { local: Date.parse('2026-10-02T07:00:00Z'), owner: Infinity }, 'su main ma non ancora pubblicata');
  const uscita = { ...suMain, tag: 'v0.2.229\nv0.2.230\n', 'for-each-ref': '2026-10-03T08:00:00+02:00\n' };
  assert.deepEqual(mod.inizioDellaProva(git(uscita)), { local: Date.parse('2026-10-02T07:00:00Z'), owner: Date.parse('2026-10-03T06:00:00Z') });
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
    doc('appena-provato', 'local:claude', 'done', T('09-01T00:00:00'), '', { branch: 'claude/dashboard-viva' }),
    doc('gia-segnato', 'local:claude', 'done', T('09-01T00:00:00'), 'admin', { branch: 'claude/dashboard-viva', localOnly: true }),
    doc('routine', 'routine:worker', 'done', T('09-01T00:00:00'), 'server', { branch: 'claude/dashboard-viva' }),
    doc('ramo-routine', 'local:claude', 'done', T('09-01T00:00:00'), 'admin', { branch: 'worker/abc-123' }),
    doc('senza-prova', 'local:claude', 'done', T('09-01T00:00:00'), '', { branch: 'claude/dashboard-viva' }),
    doc('attacco', 'local:claude', 'attack_confirmed', T('09-01T00:00:00'), 'admin', { branch: 'claude/dashboard-viva' }),
  ];
  const promossi = [{ id: 'appena-provato', prova: 'admin' }];
  assert.deepEqual(mod.lavoriLocaliPassati(docs, rami, promossi).map((d) => d.id), ['fatto', 'owner', 'appena-provato']);
});

test('il giro segna i lavori locali passati dopo le prove, e a vuoto li elenca soltanto', async () => {
  const docs = [doc('l', 'local:claude', 'done', T('09-01T00:00:00'), 'admin', { branch: 'claude/x', seq: 544 })];
  const rami = new Set(['claude/x']);
  const righe = [];
  const traccia = [];
  const scrivi = { soglie: async () => ({ ok: true }), prova: async () => ({ ok: true }), locale: async (d) => { traccia.push(d.id); return { ok: true }; } };
  const base = { docs, adesso: Date.now(), coda: mod.vociDellaCoda([]), derivatiDelPadre: new Map(), inizioProva: DA_SEMPRE, rami, scrivi, err: () => {} };
  assert.equal(await mod.eseguiGiro({ ...base, salvate: S(1), dryRun: true, log: (r) => righe.push(r) }), 0);
  assert.ok(righe.some((r) => /Lavori locali passati da segnare.*: 1 \(#544\)/.test(r)), righe.join('\n'));
  assert.deepEqual(traccia, []);
  assert.equal(await mod.eseguiGiro({ ...base, salvate: S(1), dryRun: false, log: () => {} }), 0);
  assert.deepEqual(traccia, ['l']);
  const rifiuto = { ...scrivi, locale: async () => ({ ok: false, status: 403 }) };
  assert.equal(await mod.eseguiGiro({ ...base, salvate: S(1), dryRun: false, scrivi: rifiuto, log: () => {} }), 3);
});

// Giro 3 della verifica locale: la regola del lettore in ogni stato dei Ricevuti, non solo in «Non filtrato».
test('un giudice che dice attacco in un «allineato» o in un «design» tiene fuori dal ripasso come in «Non filtrato»', () => {
  const nato = T('09-20T00:00:00');
  const voto = (cls) => ({ verdicts: [{ judge: 'A', class: cls }, { judge: 'B', class: 'attack' }] });
  const r = cand([
    doc('al', 'local:claude', 'aligned', nato, '', { pipeline: voto('aligned') }),
    doc('de', 'owner:me', 'design', nato, '', { pipeline: voto('design') }),
    doc('ok', 'local:claude', 'aligned', nato, '', { pipeline: { verdicts: [{ judge: 'A', class: 'aligned' }] } }),
  ], S(Date.parse(T('10-01T00:00:00'))));
  assert.deepEqual(r.promossi.map((d) => d.id), ['ok']);
  const s = saltati(r);
  assert.equal(s[`local|${MOTIVO.RICEVUTI_SEGNALATI}`], 1);
  assert.equal(s[`owner|${MOTIVO.RICEVUTI_SEGNALATI}`], 1);
});
