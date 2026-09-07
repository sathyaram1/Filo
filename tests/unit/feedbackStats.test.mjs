// I conti della scheda «Statistiche feedback» (src/shared/feedbackStats.js,
// feedback #496). PURI: qui si inchiodano le definizioni — cosa vuol dire
// «lavorato», da quando parte una finestra, quanti giri è costato un pass.
//
// Le note di verifica NON si ricopiano a mano: le fanno produrre alle due
// funzioni che le scrivono davvero (`SN_VERIFIER_ROUND.roundNote` di oggi e
// `verifierNoteText` di dispatch, il formato storico ancora in giro sui
// feedback vecchi). Se un giorno cambiano le parole, il rosso arriva qui e non
// un anno dopo guardando un grafico che conta zero.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
require(resolve(ROOT, 'src', 'shared', 'feedbackTransitions.js'));
require(resolve(ROOT, 'src', 'shared', 'verifierRound.js'));
require(resolve(ROOT, 'src', 'shared', 'feedbackStatus.js'));
require(resolve(ROOT, 'src', 'shared', 'manageReview.js'));
require(resolve(ROOT, 'src', 'shared', 'feedbackThread.js'));
require(resolve(ROOT, 'src', 'shared', 'feedbackStats.js'));

const S = globalThis.SN_FEEDBACK_STATS;
const ROUND = globalThis.SN_VERIFIER_ROUND;
const TH = globalThis.SN_FEEDBACK_THREAD;
const MR = globalThis.SN_MANAGE_REVIEW;

const { verifierNoteText } = await import(resolve(ROOT, 'scripts', 'dispatch.mjs'));

// Le note come le scrive il verificatore di oggi.
const notaPass = () => ROUND.roundNote({ summary: 'Provato tutto.', findings: [] });
const notaCorretti = () => ROUND.roundNote({
  summary: 'Quasi.',
  findings: [{ level: 2, text: 'Il pulsante non salva.', decision: false }],
  decision: { stop: false, fix: [{ level: 2, text: 'Il pulsante non salva.', decision: false }] },
});
const notaFermata = () => ROUND.roundNote({
  summary: 'No.',
  findings: [{ level: 3, text: 'Perde i dati.', decision: true }],
  decision: { stop: true, fix: [] },
});
const notaDerivati = () => ROUND.roundNote({
  summary: 'Va.',
  findings: [{ level: 1, text: 'Bordo freddo.', decision: true }],
  decision: { stop: false, fix: [] },
});

// Un turno nuovo dentro `notes`, con lo stesso marcatore che usa la dashboard.
const turno = (testo) => `${TH.modelTurnMarker ? '' : ''}--- Aggiornamento dell'agente del 1/1/2026 ---\n${testo}`;
const note = (...blocchi) => blocchi.map((b, i) => (i === 0 ? b : turno(b))).join('\n');

// ── Le note di verifica, lette dal formato che i produttori scrivono ─────────

test('parseVerifications riconosce il formato di oggi: pass, giro corretto, giro fermato, rilievi derivati', () => {
  assert.deepEqual(S.parseVerifications(notaPass()), [{ outcome: 'pass', findings: 0 }]);
  assert.deepEqual(S.parseVerifications(notaCorretti()), [{ outcome: 'migliorabile', findings: 1 }]);
  assert.deepEqual(S.parseVerifications(notaFermata()), [{ outcome: 'fail', findings: 1 }]);
  // Rilievi che vanno nel feedback derivato: il lavoro PROSEGUE, quindi non è
  // un fail. Contarlo come tale gonfierebbe i blocchi di un terzo.
  assert.deepEqual(S.parseVerifications(notaDerivati()), [{ outcome: 'migliorabile', findings: 1 }]);
});

test('parseVerifications riconosce anche il formato storico di dispatch', () => {
  assert.deepEqual(S.parseVerifications(verifierNoteText('pass')), [{ outcome: 'pass', findings: 0 }]);
  assert.deepEqual(S.parseVerifications(verifierNoteText('fail', 'il tema scuro resta invisibile')),
    [{ outcome: 'fail', findings: 1 }]);
  assert.deepEqual(S.parseVerifications(verifierNoteText('migliorabile', 'il bordo è freddo')),
    [{ outcome: 'migliorabile', findings: 1 }]);
});

test('due giri nello stesso blocco di note si contano due volte; un report senza verifiche zero', () => {
  const n = note(notaCorretti(), notaFermata(), notaPass());
  assert.equal(S.parseVerifications(n).length, 3);
  assert.deepEqual(S.parseVerifications('Ho implementato la cosa. Fatto.'), []);
  assert.deepEqual(S.parseVerifications(''), []);
  assert.deepEqual(S.parseVerifications(null), []);
});

test('verificationSummary conta le critiche PRIMA del primo pass, non quelle dopo una riapertura', () => {
  const primoColpo = S.verificationSummary(note('Report.', notaPass()));
  assert.equal(primoColpo.loopsBeforePass, 0);
  assert.equal(primoColpo.passed, true);

  const dueGiri = S.verificationSummary(note('Report.', notaCorretti(), notaCorretti(), notaPass()));
  assert.equal(dueGiri.loopsBeforePass, 2);
  assert.equal(dueGiri.migliorabile, 2);
  assert.equal(dueGiri.fail, 0);

  const riaperto = S.verificationSummary(note('Report.', notaPass(), notaCorretti(), notaPass()));
  assert.equal(riaperto.loopsBeforePass, 0, 'i giri dopo il pass non ne cambiano il costo');
  assert.equal(riaperto.critiche, 1, 'ma restano contati come critiche');
});

test('un lavoro fermato non ha un numero di giri: null, non zero', () => {
  const v = S.verificationSummary(note('Report.', notaCorretti(), notaFermata()));
  assert.equal(v.passed, false);
  assert.equal(v.loopsBeforePass, null, 'nel secchio «nessuna critica» direbbe il contrario di com\'è andata');
  assert.equal(v.fail, 1);
  assert.equal(v.migliorabile, 1);
});

// ── La finestra ─────────────────────────────────────────────────────────────

const NOW = new Date('2026-09-07T15:30:00');

test('la finestra parte da mezzanotte, e «oggi» è oggi intero', () => {
  const oggi = S.windowRange('today', { now: NOW });
  assert.equal(new Date(oggi.from).getHours(), 0);
  assert.equal(new Date(oggi.from).getDate(), 7);
  assert.equal(oggi.to - oggi.from, 86400000);
  // Un feedback arrivato stamattina alle 2 è di oggi: con una finestra «ultime
  // 24 ore» ci sarebbe stato solo per caso.
  assert.equal(S.inRange(new Date('2026-09-07T02:00:00').getTime(), oggi), true);
  assert.equal(S.inRange(new Date('2026-09-06T23:59:00').getTime(), oggi), false);
});

test('gli «ultimi 7 giorni» sono 7 giorni di calendario, oggi compreso', () => {
  const r = S.windowRange('7d', { now: NOW });
  assert.equal(r.to - r.from, 7 * 86400000);
  assert.equal(new Date(r.from).getDate(), 1);
});

test('«Sempre» non ha limiti; la finestra personalizzata comprende il giorno finale per intero', () => {
  const tutto = S.windowRange('all', { now: NOW });
  assert.equal(tutto.from, null);
  assert.equal(tutto.to, null);
  assert.equal(S.inRange(0, tutto), true);

  const p = S.windowRange('custom', { now: NOW, fromISO: '2026-09-01', toISO: '2026-09-03' });
  assert.equal(S.inRange(new Date('2026-09-03T23:00:00').getTime(), p), true,
    'il giorno finale conta tutto, o «dal 1 al 3» perde il 3');
  assert.equal(S.inRange(new Date('2026-09-04T00:10:00').getTime(), p), false);

  const invertita = S.windowRange('custom', { now: NOW, fromISO: '2026-09-03', toISO: '2026-09-01' });
  assert.equal(S.inRange(new Date('2026-09-02T12:00:00').getTime(), invertita), true,
    'date invertite si raddrizzano: nessuno intende «dal 10 al 3» come «niente»');

  const vuota = S.windowRange('custom', { now: NOW });
  assert.ok(vuota.invalid, 'senza nessuna delle due date lo dice, invece di mostrare zero');
});

test('una sola delle due date personalizzate è un limite legittimo, non un errore', () => {
  const da = S.windowRange('custom', { now: NOW, fromISO: '2026-09-05' });
  assert.equal(da.invalid, undefined);
  assert.equal(da.to, null);
  assert.equal(S.inRange(new Date('2027-01-01').getTime(), da), true);
});

// ── Il conto intero ─────────────────────────────────────────────────────────

const ISO = (d) => new Date(d).toISOString();
const fbDi = (o) => Object.assign({
  _id: o.id, seq: o.seq || 1, createdAt: ISO(o.at), clientId: o.clientId || 'utente-1',
  status: o.status || 'todo', notes: o.notes || '', priority: o.priority || 0,
}, o.extra || {});

const statusOf = (fb) => ({ status: MR.normalizeStatus(fb).status, unreadable: MR.statusUnreadable(fb) });
const conta = (feedbacks, opts = {}) => S.compute({
  feedbacks, workerLog: opts.workerLog || [], now: NOW,
  range: opts.range || S.windowRange('30d', { now: NOW }),
  creators: opts.creators,
  authorKindOf: (fb) => TH.authorKind(fb && fb.clientId),
  statusOf,
});

test('i feedback si scelgono per data d\'arrivo e per creatore', () => {
  const list = [
    fbDi({ id: 'a', at: '2026-09-06T10:00:00', clientId: 'utente-1', status: 'todo' }),
    fbDi({ id: 'b', at: '2026-09-05T10:00:00', clientId: 'routine:prober', status: 'todo' }),
    fbDi({ id: 'c', at: '2026-01-01T10:00:00', clientId: 'routine:prober', status: 'todo' }),
  ];
  assert.equal(conta(list).ricevuti, 2, 'quello di gennaio è fuori dagli ultimi 30 giorni');
  assert.equal(conta(list, { creators: ['prober'] }).ricevuti, 1);
  assert.equal(conta(list, { creators: ['prober'], range: S.windowRange('all', { now: NOW }) }).ricevuti, 2);
  // Filtro vuoto = tutti, mai «nessuno»: una pagina di zeri senza spiegazione
  // è peggio di nessun filtro.
  assert.equal(conta(list, { creators: [] }).ricevuti, 2);
});

test('«lavorato» vuol dire entrato in lavorazione, «risolto» vuol dire chiuso', () => {
  const list = [
    fbDi({ id: 'a', at: '2026-09-06T10:00:00', status: 'todo' }),
    fbDi({ id: 'b', at: '2026-09-06T10:00:00', status: 'working' }),
    fbDi({ id: 'c', at: '2026-09-06T10:00:00', status: 'revision_security' }),
    fbDi({ id: 'd', at: '2026-09-06T10:00:00', status: 'done' }),
    fbDi({ id: 'e', at: '2026-09-06T10:00:00', status: 'archived' }),
    fbDi({ id: 'f', at: '2026-09-06T10:00:00', status: 'attack' }),
  ];
  const s = conta(list);
  assert.equal(s.ricevuti, 6);
  assert.equal(s.lavorati, 4, 'in coda e attacco non sono stati lavorati');
  assert.equal(s.risolti, 2);
  const cat = Object.fromEntries(s.categorie.map((c) => [c.key, c.count]));
  assert.deepEqual(cat, { todo: 1, lavorazione: 2, done: 1, archived: 1, attacco: 1 });
});

test('uno stato che questo computer non sa leggere finisce fra gli illeggibili, non in una categoria a caso', () => {
  const list = [
    fbDi({ id: 'a', at: '2026-09-06T10:00:00', status: 'FENC1:blob-che-non-si-legge' }),
    fbDi({ id: 'b', at: '2026-09-06T10:00:00', status: 'done' }),
  ];
  const s = conta(list);
  assert.equal(s.ricevuti, 2);
  assert.equal(s.illeggibili, 1);
  assert.equal(s.categorie.reduce((n, c) => n + c.count, 0), 1);
});

test('la torta dei giri: un secchio per numero di critiche, i fermati contati a parte', () => {
  const list = [
    fbDi({ id: 'a', at: '2026-09-06T10:00:00', status: 'done', notes: note('R.', notaPass()) }),
    fbDi({ id: 'b', at: '2026-09-06T10:00:00', status: 'done', notes: note('R.', notaPass()) }),
    fbDi({ id: 'c', at: '2026-09-06T10:00:00', status: 'done', notes: note('R.', notaCorretti(), notaPass()) }),
    fbDi({ id: 'd', at: '2026-09-06T10:00:00', status: 'design', notes: note('R.', notaCorretti(), notaFermata()) }),
    fbDi({ id: 'e', at: '2026-09-06T10:00:00', status: 'todo', notes: 'Nessuna verifica ancora.' }),
  ];
  const { loop } = conta(list);
  assert.equal(loop.conVerifica, 4, 'quello senza verifiche non entra nella torta');
  assert.equal(loop.passati, 3);
  assert.equal(loop.nonPassati, 1);
  assert.deepEqual(loop.slices.map((s) => [s.loops, s.count]), [[0, 2], [1, 1]]);
  assert.equal(loop.media, 1 / 3);
  assert.equal(loop.fail, 1);
  assert.equal(loop.migliorabile, 2);
  assert.equal(loop.critiche, 3);
});

test('le fette della torta restano in ordine di giri, non di dimensione', () => {
  const tanti = (n, giri) => Array.from({ length: n }, (_, i) => fbDi({
    id: `x${giri}-${i}`, at: '2026-09-06T10:00:00', status: 'done',
    notes: note('R.', ...Array.from({ length: giri }, notaCorretti), notaPass()),
  }));
  const { loop } = conta([...tanti(1, 0), ...tanti(5, 2)]);
  assert.deepEqual(loop.slices.map((s) => s.loops), [0, 2],
    'una torta che racconta una scala non si riordina per grandezza');
});

test('oltre il quarto giro il dettaglio collassa in «4+»', () => {
  const list = [fbDi({
    id: 'a', at: '2026-09-06T10:00:00', status: 'done',
    notes: note('R.', notaCorretti(), notaCorretti(), notaCorretti(), notaCorretti(), notaCorretti(), notaPass()),
  })];
  const { loop } = conta(list);
  assert.deepEqual(loop.slices.map((s) => s.label), ['4+ critiche']);
  assert.equal(loop.media, 5, 'la media resta il numero vero, non quello del secchio');
});

test('le esecuzioni delle routine si contano sul loro orologio e rispettano il filtro creatore', () => {
  const log = [
    { role: 'prober', startedAt: ISO('2026-09-06T10:00:00'), num: '' },
    { role: 'prober', startedAt: ISO('2026-09-06T12:00:00'), num: '' },
    { role: 'prober', startedAt: ISO('2026-01-01T12:00:00'), num: '' },
    { role: 'verifier', startedAt: ISO('2026-09-06T13:00:00'), num: '#12' },
    { role: 'idle', startedAt: ISO('2026-09-06T14:00:00'), num: '' },
  ];
  const s = conta([], { workerLog: log });
  assert.equal(s.prober, 2, 'quella di gennaio è fuori finestra');
  assert.equal(s.esecuzioni, 3, '«Fermo» non è lavoro e non si conta');
  assert.equal(S.toMillis(s.runsLogFrom), new Date('2026-01-01T12:00:00').getTime(),
    'da quando il registro racconta: serve a dire che su una finestra lunga il numero è un minimo');

  const solePersone = conta([], { workerLog: log, creators: ['owner', 'user'] });
  assert.equal(solePersone.prober, 0, 'chiedere «solo le persone» deve azzerare le esecuzioni, non lasciarle a contraddire il filtro');
  const soloVerifica = conta([], { workerLog: log, creators: ['verifier'] });
  assert.equal(soloVerifica.esecuzioni, 1);
});

test('l\'andamento sceglie la barretta in base alla lunghezza della finestra', () => {
  assert.equal(S.bucketSizeFor(7 * 86400000).key, 'day');
  assert.equal(S.bucketSizeFor(90 * 86400000).key, 'week');
  assert.equal(S.bucketSizeFor(365 * 86400000).key, 'month');
  // Oltre il tetto delle barrette la barretta si allarga, invece di lasciare
  // dieci anni schiacciati nell'ultima che l'etichetta non nomina.
  assert.equal(S.bucketSizeFor(10 * 365 * 86400000).key, 'year');

  const list = [
    fbDi({ id: 'a', at: '2026-09-06T10:00:00' }),
    fbDi({ id: 'b', at: '2026-09-06T18:00:00' }),
    fbDi({ id: 'c', at: '2026-09-07T09:00:00' }),
  ];
  const s = conta(list, { range: S.windowRange('7d', { now: NOW }) });
  assert.equal(s.andamento.bucket.key, 'day');
  assert.equal(s.andamento.barre.length, 7);
  assert.deepEqual(s.andamento.barre.map((b) => b.count), [0, 0, 0, 0, 0, 2, 1]);
  assert.equal(s.andamento.barre.reduce((n, b) => n + b.count, 0), s.ricevuti,
    'ogni feedback della finestra sta in esattamente una barretta');
});

test('su una finestra lunghissima le barrette restano sotto il tetto e coprono tutta la finestra', () => {
  const vecchi = Array.from({ length: 12 }, (_, i) => fbDi({
    id: `v${i}`, at: new Date(NOW.getTime() - i * 300 * 86400000).toISOString(), status: 'todo',
  }));
  const s = conta(vecchi, { range: S.windowRange('all', { now: NOW }) });
  assert.ok(s.andamento.barre.length <= S.MAX_BARRE);
  const ultima = s.andamento.barre[s.andamento.barre.length - 1];
  assert.ok(ultima.to >= NOW.getTime(),
    'l\'ultima barretta arriva fino a oggi: se si fermasse prima conterebbe roba che la sua etichetta non nomina');
  assert.equal(s.andamento.barre.reduce((n, b) => n + b.count, 0), s.ricevuti);
});

test('i gruppi di creatori coprono tutte le categorie d\'autore, senza doppioni', () => {
  const dai = S.CREATOR_GROUPS.flatMap((g) => g.kinds);
  assert.deepEqual([...dai].sort(), [...S.CREATOR_KINDS].sort(),
    'una categoria fuori dai gruppi sarebbe irraggiungibile dai pulsanti rapidi');
  assert.equal(new Set(dai).size, dai.length);
});

test('le categorie coprono ESATTAMENTE gli stati canonici della macchina a stati', () => {
  const coperti = S.CATEGORIES.flatMap((c) => c.statuses).sort();
  assert.deepEqual(coperti, [...globalThis.SN_FB_TRANSITIONS.STATUSES].sort(),
    'uno stato nuovo aggiunto alla macchina e dimenticato qui sparirebbe dai conteggi in silenzio');
});

test('riaperture e arenamenti si sommano senza contare due volte lo stesso arenamento', () => {
  const list = [
    fbDi({ id: 'a', at: '2026-09-06T10:00:00', extra: { reopenRequests: 2, stalls: 3, workingResets: 1 } }),
    fbDi({ id: 'b', at: '2026-09-06T10:00:00', extra: { workingResets: 2 } }),
  ];
  const s = conta(list);
  assert.equal(s.riaperture, 2);
  assert.equal(s.stalli, 5, '3 (totale che non si azzera) + 2, non 3+1+2');
});

// ── Correzioni del giro 1 di verifica (#496) ─────────────────────────────────

test('ogni gruppo porta gli id delle segnalazioni che lo compongono', () => {
  const list = [
    fbDi({ id: 'a', at: '2026-09-06T10:00:00', status: 'done', clientId: 'owner:pino', notes: note('R.', notaPass()) }),
    fbDi({ id: 'b', at: '2026-09-06T10:00:00', status: 'done', clientId: 'routine:prober', notes: note('R.', notaCorretti(), notaPass()) }),
    fbDi({ id: 'c', at: '2026-09-05T10:00:00', status: 'todo', clientId: 'routine:prober' }),
    fbDi({ id: 'd', at: '2026-09-05T10:00:00', status: 'working', clientId: 'utente-1', notes: note('R.', notaFermata()) }),
  ];
  const s = conta(list);
  const cat = (k) => s.categorie.find((c) => c.key === k);
  assert.deepEqual(cat('done').ids.sort(), ['a', 'b'],
    'senza gli id, da «Risolto: 2» non si può arrivare ai due risolti');
  assert.deepEqual(cat('todo').ids, ['c']);
  assert.deepEqual(s.idsNonLavorati, ['c'], 'gli unici non lavorati sono i todo');
  const creatore = (k) => s.creatori.find((c) => c.key === k);
  assert.deepEqual(creatore('prober').ids.sort(), ['b', 'c']);
  // Le fette della torta e i fermati portano i loro id come le righe.
  assert.deepEqual(s.loop.slices.find((x) => x.loops === 0).ids, ['a']);
  assert.deepEqual(s.loop.slices.find((x) => x.loops === 1).ids, ['b']);
  assert.deepEqual(s.loop.nonPassatiIds, ['d']);
  // La somma degli id per categoria non perde né duplica nessuna segnalazione.
  const tutti = s.categorie.flatMap((c) => c.ids).concat(s.idsIlleggibili).sort();
  assert.deepEqual(tutti, ['a', 'b', 'c', 'd']);
});

test('una segnalazione illeggibile non vale «zero giri»: si conta a parte e si dichiara', () => {
  const list = [
    fbDi({ id: 'ok', at: '2026-09-06T10:00:00', status: 'done', notes: note('R.', notaPass()) }),
    fbDi({ id: 'cifrata', at: '2026-09-06T10:00:00', status: 'FENC1:abc', notes: 'FENC1:xyz' }),
  ];
  const s = conta(list);
  assert.equal(s.illeggibili, 1);
  assert.deepEqual(s.idsIlleggibili, ['cifrata']);
  assert.equal(s.loop.nonLeggibili, 1,
    'senza questo numero la cifrata sparisce dalla torta in silenzio, mentre per categoria viene dichiarata');
  assert.equal(s.loop.conVerifica, 1, 'la cifrata non entra nei conti dei giri');
  assert.equal(s.loop.passati, 1);
});

test('intervalli di secoli: le barrette coprono tutta la finestra invece di fermarsi a metà', () => {
  const range = S.windowRange('custom', { now: NOW, fromISO: '1900-01-01', toISO: '2026-09-07' });
  const s = conta([fbDi({ id: 'a', at: '2026-09-06T10:00:00', status: 'todo' })], { range });
  const barre = s.andamento.barre;
  assert.ok(barre.length <= S.MAX_BARRE);
  const ultima = barre[barre.length - 1];
  assert.ok(ultima.to >= range.to,
    'l\'ultima barretta deve arrivare alla fine della finestra: fermandosi nel 1959 contava i feedback di oggi sotto un\'etichetta del 1959');
  const piena = barre.find((b) => b.count > 0);
  assert.ok(piena.from <= Date.parse('2026-09-06T10:00:00') && Date.parse('2026-09-06T10:00:00') < piena.to,
    'il feedback sta nella barretta il cui intervallo lo contiene davvero');
  assert.equal(s.andamento.bucket.key, 'years');
  assert.ok(s.andamento.bucket.anni >= 2);
});

test('bucketSizeFor non restituisce mai una barretta che sfora il tetto', () => {
  const DAY = 86400000;
  for (const giorni of [1, 30, 31, 32, 200, 201, 1800, 1801, 20000, 46000, 400000]) {
    const span = giorni * DAY;
    const b = S.bucketSizeFor(span);
    assert.ok(Math.ceil(span / b.ms) <= S.MAX_BARRE,
      `${giorni} giorni: ${Math.ceil(span / b.ms)} barrette, oltre il tetto di ${S.MAX_BARRE}`);
    assert.ok(b.label, 'ogni scalino ha un nome da scrivere sotto il grafico');
  }
});
