// Unit test per src/shared/feedbackStats.js — i conti della scheda
// «Statistiche feedback» della dashboard di gestione (feedback #496).
//
// Quello che sorveglia, e che senza il modulo è tutto rosso:
//   · la finestra di riferimento: «Oggi» parte dall'inizio del giorno, non da
//     ventiquattr'ore fa; gli estremi scelti a mano sono inclusi e si
//     raddrizzano se invertiti;
//   · le DUE sorgenti con le DUE date: i ricevuti si contano sulla data
//     d'invio, i lavorati sulla data di lavorazione — un feedback vecchio
//     lavorato oggi è lavoro di oggi;
//   · i giri prima del via libera = lanci del verificatore meno uno, e un
//     lavoro fermato in attesa dell'owner non entra nella media;
//   · il filtro per creatore, che vale anche sui numeri che arrivano dal
//     registro dei worker;
//   · la copertura dichiarata: il registro è una finestra e il modulo dice
//     da quando parte, invece di far passare un minimo per un totale.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED = join(__dirname, '..', '..', 'src', 'shared');
require(join(SHARED, 'feedbackThread.js'));
require(join(SHARED, 'feedbackTransitions.js'));
require(join(SHARED, 'feedbackStatus.js'));
require(join(SHARED, 'manageReview.js'));
require(join(SHARED, 'feedbackStats.js'));

const S = globalThis.SN_FEEDBACK_STATS;

// Un istante fisso, così i test non dipendono da quando girano.
const ORA = new Date('2026-09-19T15:00:00').getTime();
const g = (n) => new Date(ORA - n * 24 * 60 * 60 * 1000).toISOString();

function fb(over = {}) {
  return Object.assign({
    _id: 'id-' + Math.random().toString(36).slice(2),
    seq: 1, subSeq: 0,
    clientId: 'utente-xyz',
    createdAt: g(1),
    status: 'todo',
  }, over);
}

// ── La finestra di riferimento ──────────────────────────────────────────────

test('«Oggi» parte dall\'inizio del giorno, non da 24 ore fa', () => {
  const r = S.rangeOf('oggi', ORA);
  const inizio = new Date(ORA); inizio.setHours(0, 0, 0, 0);
  assert.equal(r.da, inizio.getTime());
  // Un fatto di stamattina alle 2 è «oggi»; uno di ieri alle 23 non lo è.
  const stamattina = new Date(ORA); stamattina.setHours(2, 0, 0, 0);
  const ierisera = new Date(ORA - 24 * 3600 * 1000); ierisera.setHours(23, 0, 0, 0);
  assert.equal(S.inRange(new Date(stamattina).toISOString(), r), true);
  assert.equal(S.inRange(new Date(ierisera).toISOString(), r), false);
});

test('«7 giorni» copre sette giorni interi, oggi compreso', () => {
  const r = S.rangeOf('7g', ORA);
  const atteso = new Date(ORA); atteso.setHours(0, 0, 0, 0);
  assert.equal(r.da, atteso.getTime() - 6 * 24 * 3600 * 1000);
});

test('«Tutto» non ha inizio: prende anche un feedback di due anni fa', () => {
  const r = S.rangeOf('tutto', ORA);
  assert.equal(r.da, null);
  assert.equal(S.inRange(g(700), r), true);
});

test('finestra scelta a mano: estremi inclusi, e invertiti si raddrizzano', () => {
  const r = S.rangeOf('custom', ORA, { da: '2026-09-10', a: '2026-09-12' });
  assert.equal(S.inRange('2026-09-10T00:00:00', r), true);
  assert.equal(S.inRange('2026-09-12T23:59:00', r), true);
  assert.equal(S.inRange('2026-09-13T00:30:00', r), false);
  const storto = S.rangeOf('custom', ORA, { da: '2026-09-12', a: '2026-09-10' });
  assert.equal(storto.da, r.da);
  assert.equal(storto.a, r.a);
});

test('una data illeggibile non cade mai dentro la finestra', () => {
  const r = S.rangeOf('tutto', ORA);
  assert.equal(S.inRange('', r), false);
  assert.equal(S.inRange(null, r), false);
  assert.equal(S.inRange('non una data', r), false);
});

// ── Numeri ──────────────────────────────────────────────────────────────────

test('i numeri si normalizzano dalle due parti (col cancelletto e senza)', () => {
  assert.equal(S.normNum('#496'), '496');
  assert.equal(S.normNum('496.1'), '496.1');
  assert.equal(S.normNum(496), '496');
  assert.equal(S.normNum('ciao'), '');
  assert.equal(S.numeroDi({ seq: 496, subSeq: 0 }), '496');
  assert.equal(S.numeroDi({ seq: 496, subSeq: 2 }), '496.2');
  assert.equal(S.numeroPadre('496.2'), '496');
  assert.equal(S.numeroPadre('496'), '496');
});

// ── Ricevuti: data d'invio, categorie, creatori ─────────────────────────────

test('i ricevuti si contano sulla data d\'invio e si dividono per categoria', () => {
  const r = S.compute({
    range: S.rangeOf('7g', ORA),
    feedbacks: [
      fb({ seq: 1, createdAt: g(1), status: 'todo' }),
      fb({ seq: 2, createdAt: g(2), status: 'todo' }),
      fb({ seq: 3, createdAt: g(3), status: 'spam' }),
      fb({ seq: 4, createdAt: g(40), status: 'todo' }),   // fuori finestra
    ],
    workerLog: [],
  });
  assert.equal(r.ricevuti.totale, 3);
  const perChiave = Object.fromEntries(r.ricevuti.categorie.map((c) => [c.key, c.n]));
  assert.equal(perChiave.todo, 2);
  assert.equal(perChiave.spam, 1);
});

test('il filtro per creatore tiene solo i mittenti scelti', () => {
  const lista = [
    fb({ seq: 1, clientId: 'agent:prober' }),
    fb({ seq: 2, clientId: 'agent:prober' }),
    fb({ seq: 3, clientId: 'utente-abc' }),
    fb({ seq: 4, clientId: 'owner:me' }),
  ];
  const tutti = S.compute({ range: S.rangeOf('7g', ORA), feedbacks: lista, workerLog: [] });
  assert.equal(tutti.ricevuti.totale, 4);
  const soloProber = S.compute({
    range: S.rangeOf('7g', ORA), feedbacks: lista, workerLog: [], creatori: ['prober'],
  });
  assert.equal(soloProber.ricevuti.totale, 2);
  assert.deepEqual(soloProber.ricevuti.creatori.map((c) => [c.kind, c.n]), [['prober', 2]]);
  // …ma il conto di OGNI mittente resta quello vero: è il numero scritto nella
  // pasticca, e serve a decidere quale accendere dopo. Col filtro acceso le
  // pasticche spente andavano tutte a zero.
  assert.deepEqual(
    soloProber.ricevuti.creatoriTutti.map((c) => [c.kind, c.n]).sort(),
    [['owner', 1], ['prober', 2], ['user', 1]].sort(),
  );
});

test('la divisione per categoria chiama ogni stato col suo nome', () => {
  const r = S.compute({
    range: S.rangeOf('7g', ORA),
    feedbacks: [fb({ seq: 1, status: 'todo' }), fb({ seq: 2, status: 'done' }), fb({ seq: 3, status: 'spam' })],
    workerLog: [],
  });
  const nomi = r.ricevuti.categorie.map((c) => c.label);
  assert.equal(new Set(nomi).size, 3, `nomi ripetuti: ${JSON.stringify(nomi)}`);
  for (const n of nomi) assert.ok(!/ignoto/i.test(n), `categoria senza nome: ${n}`);
  assert.equal(r.ricevuti.categorie.find((c) => c.key === 'todo').label, 'In coda');
});

test('una data d\'arrivo che non si legge si conta a parte, non sparisce', () => {
  const r = S.compute({
    range: S.rangeOf('tutto', ORA),
    feedbacks: [fb({ seq: 1 }), fb({ seq: 2, createdAt: null }), fb({ seq: 3, createdAt: 'boh' })],
    workerLog: [],
  });
  assert.equal(r.ricevuti.totale, 1);
  assert.equal(r.ricevuti.senzaData, 2);
});

test('«Tutto» prende anche una segnalazione con l\'orologio avanti', () => {
  const domani = new Date(ORA + 3 * 24 * 3600 * 1000).toISOString();
  const r = S.compute({
    range: S.rangeOf('tutto', ORA),
    feedbacks: [fb({ seq: 1 }), fb({ seq: 2, createdAt: domani })],
    workerLog: [],
  });
  assert.equal(r.ricevuti.totale, 2);
  // Le finestre a giorni, invece, finiscono a oggi: lì è giusto lasciarla fuori.
  const settimana = S.compute({
    range: S.rangeOf('7g', ORA),
    feedbacks: [fb({ seq: 1 }), fb({ seq: 2, createdAt: domani })],
    workerLog: [],
  });
  assert.equal(settimana.ricevuti.totale, 1);
});

test('lo stato che questa chiave non legge diventa una categoria sua, non sparisce', () => {
  const r = S.compute({
    range: S.rangeOf('7g', ORA),
    feedbacks: [fb({ seq: 1, status: 'FENC1:qualcosa-di-cifrato' })],
    workerLog: [],
  });
  assert.equal(r.ricevuti.totale, 1);
  assert.equal(r.ricevuti.categorie[0].key, '__illeggibile');
});

// ── Lavorati: data di lavorazione, non d'invio ──────────────────────────────

test('un feedback vecchio lavorato oggi conta come lavoro di oggi', () => {
  const r = S.compute({
    range: S.rangeOf('7g', ORA),
    feedbacks: [fb({ seq: 77, createdAt: g(200), status: 'done' })],
    workerLog: [
      { role: 'new-work', startedAt: g(2), num: '77' },
      { role: 'verifier', startedAt: g(2), num: '77' },
    ],
  });
  // Non è fra i RICEVUTI della settimana (è di 200 giorni fa)…
  assert.equal(r.ricevuti.totale, 0);
  // …ma è fra i LAVORATI.
  assert.equal(r.lavorati.totale, 1);
});

test('le esplorazioni si contano per lancio, e i ritrovamenti per feedback', () => {
  const r = S.compute({
    range: S.rangeOf('7g', ORA),
    feedbacks: [
      fb({ seq: 10, clientId: 'agent:prober', createdAt: g(1) }),
      fb({ seq: 11, clientId: 'agent:prober', createdAt: g(2) }),
      fb({ seq: 12, clientId: 'agent:prober', createdAt: g(30) }), // fuori finestra
    ],
    workerLog: [
      { role: 'prober', startedAt: g(1), num: '' },
      { role: 'prober', startedAt: g(2), num: '' },
      { role: 'prober', startedAt: g(3), num: '' },
      { role: 'prober', startedAt: g(30), num: '' },  // fuori finestra
    ],
  });
  assert.equal(r.prober.lanciati, 3);
  assert.equal(r.prober.ritrovamenti, 2);
});

// ── La torta dei giri ───────────────────────────────────────────────────────

test('i giri prima del via libera sono i lanci del verificatore meno uno', () => {
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [
      fb({ seq: 1, status: 'done' }),
      fb({ seq: 2, status: 'done' }),
      fb({ seq: 3, status: 'done' }),
    ],
    workerLog: [
      // #1: una sola verifica → passato subito
      { role: 'verifier', startedAt: g(5), num: '1' },
      // #2: tre verifiche → due critiche
      { role: 'verifier', startedAt: g(5), num: '2' },
      { role: 'verifier', startedAt: g(4), num: '2' },
      { role: 'verifier', startedAt: g(3), num: '2' },
      // #3: due verifiche → una critica
      { role: 'verifier', startedAt: g(2), num: '3' },
      { role: 'verifier', startedAt: g(1), num: '3' },
    ],
  });
  const fette = Object.fromEntries(r.giri.fette.map((f) => [f.key, f.n]));
  assert.equal(fette.g0, 1);
  assert.equal(fette.g1, 1);
  assert.equal(fette.g2, 1);
  assert.equal(r.giri.conteggio, 3);
  assert.equal(r.giri.media, (0 + 2 + 1) / 3);
});

test('un lavoro fermato in attesa dell\'owner è una fetta sua e non sposta la media', () => {
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [
      fb({ seq: 1, status: 'done' }),
      fb({ seq: 2, status: 'design', statusReason: 'loop' }),
    ],
    workerLog: [
      { role: 'verifier', startedAt: g(5), num: '1' },
      { role: 'verifier', startedAt: g(5), num: '2' },
      { role: 'verifier', startedAt: g(4), num: '2' },
      { role: 'verifier', startedAt: g(3), num: '2' },
    ],
  });
  const fette = Object.fromEntries(r.giri.fette.map((f) => [f.key, f.n]));
  assert.equal(fette.fermati, 1);
  assert.equal(r.giri.fermati, 1);
  assert.equal(r.giri.conteggio, 1);
  assert.equal(r.giri.media, 0);   // solo #1 entra nella media
});

test('anche il controllo di sicurezza bocciato ferma il lavoro', () => {
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [fb({ seq: 1, status: 'revision_security', livelli: { l4: { esito: 'fail' } } })],
    workerLog: [{ role: 'verifier', startedAt: g(2), num: '1' }],
  });
  assert.equal(r.giri.fermati, 1);
  assert.equal(r.audit.fail, 1);
});

test('i rilievi rimandati si riconoscono dal feedback derivato figlio', () => {
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [
      fb({ seq: 1, status: 'done' }),
      fb({ seq: 1, subSeq: 1, clientId: 'routine:residuo', status: 'todo' }),
      fb({ seq: 2, status: 'done' }),
    ],
    workerLog: [
      { role: 'verifier', startedAt: g(2), num: '1' },
      { role: 'verifier', startedAt: g(2), num: '2' },
    ],
  });
  assert.equal(r.giri.rimandati, 1);
});

test('un lavoro ancora in mezzo al giro non è «passato subito»: sta fuori dalla torta', () => {
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [
      fb({ seq: 1, status: 'working' }),               // il fix è in corso
      fb({ seq: 2, status: 'revision_capability' }),   // la verifica sta girando
      fb({ seq: 3, status: 'done' }),                  // questo sì
    ],
    workerLog: [
      { role: 'verifier', startedAt: g(3), num: '1' },
      { role: 'verifier', startedAt: g(3), num: '2' },
      { role: 'verifier', startedAt: g(3), num: '3' },
    ],
  });
  const fette = Object.fromEntries(r.giri.fette.map((f) => [f.key, f.n]));
  assert.equal(fette.g0, 1, 'solo il lavoro passato sta in «passato subito»');
  assert.equal(r.giri.conteggio, 1);
  assert.equal(r.giri.aperti, 2);
  assert.equal(r.giri.apertiIds.length, 2);
});

test('senza nessun via libera la media non esiste, invece di valere zero', () => {
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [fb({ seq: 1, status: 'working' }), fb({ seq: 2, status: 'revision_capability' })],
    workerLog: [
      { role: 'verifier', startedAt: g(2), num: '1' },
      { role: 'verifier', startedAt: g(2), num: '2' },
    ],
  });
  assert.equal(r.giri.media, null);
  assert.equal(r.giri.aperti, 2);
});

test('quante critiche è costato un lavoro non cambia con la finestra che si guarda', () => {
  const lista = [fb({ seq: 1, status: 'done', createdAt: g(12) })];
  const workerLog = [
    { role: 'verifier', startedAt: g(10), num: '1' },
    { role: 'verifier', startedAt: g(5), num: '1' },
    { role: 'verifier', startedAt: g(0), num: '1' },
  ];
  for (const key of ['oggi', '7g', '30g']) {
    const r = S.compute({ range: S.rangeOf(key, ORA), feedbacks: lista, workerLog });
    const fette = Object.fromEntries(r.giri.fette.map((f) => [f.key, f.n]));
    assert.equal(fette.g2, 1, `finestra ${key}: il lavoro è costato due critiche`);
    assert.equal(r.giri.media, 2, `finestra ${key}`);
  }
});

test('un numero che il registro cita e la lista non ha resta fuori dalla torta, e si dichiara', () => {
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [],
    workerLog: [{ role: 'verifier', startedAt: g(2), num: '999' }],
  });
  assert.equal(r.giri.fette.length, 0);
  assert.equal(r.giri.ignoti, 1);
});

test('le colonne del grafico portano la data come si legge, non come si raggruppa', () => {
  const r = S.compute({
    range: S.rangeOf('7g', ORA),
    feedbacks: [fb({ seq: 1, createdAt: g(1) })],
    workerLog: [],
  });
  const p = r.ricevuti.serie.punti.find((x) => x.n > 0);
  assert.match(p.label, /^\d{1,2}\/\d{1,2}\/\d{4}$/, `etichetta: ${p.label}`);
  assert.equal(p.ids.length, 1);
});

// ── L'asse del tempo del grafico degli arrivi ───────────────────────────────
// Senza le colonne vuote, due punte distanti tre mesi uscivano appiccicate e
// larghe uguali: l'asse smetteva di essere il tempo e diventava l'elenco dei
// periodi in cui era arrivato qualcosa.

test('il grafico disegna una colonna per ogni periodo della finestra, vuoti compresi', () => {
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [fb({ seq: 1, createdAt: g(29) }), fb({ seq: 2, createdAt: g(0) })],
    workerLog: [],
  });
  const punti = r.ricevuti.serie.punti;
  assert.equal(r.ricevuti.serie.passo, 'giorno');
  assert.equal(punti.length, 30, 'trenta giorni di finestra, trenta colonne');
  assert.equal(punti[0].n, 1);
  assert.equal(punti[punti.length - 1].n, 1);
  // In mezzo ci sono i ventotto giorni in cui non è arrivato niente.
  assert.equal(punti.filter((p) => p.n === 0).length, 28);
  // Le colonne sono in ordine di tempo e ognuna dista un giorno dalla prima.
  for (let i = 1; i < punti.length; i++) assert.ok(punti[i].t > punti[i - 1].t);
});

test('il passo si allarga con la finestra, e le colonne restano un numero leggibile', () => {
  const conta = (giorni, arrivi) => S.compute({
    range: { da: ORA - giorni * 24 * 3600 * 1000, a: ORA },
    feedbacks: arrivi.map((n, i) => fb({ seq: i + 1, createdAt: g(n) })),
    workerLog: [],
  }).ricevuti.serie;
  const settimane = conta(90, [89, 0]);
  assert.equal(settimane.passo, 'settimana');
  assert.ok(settimane.punti.length >= 13, `colonne: ${settimane.punti.length}`);
  const mesi = conta(1000, [999, 0]);
  assert.equal(mesi.passo, 'mese');
  assert.ok(mesi.punti.length >= 32 && mesi.punti.length <= 40, `colonne: ${mesi.punti.length}`);
  // Oltre i dieci anni si passa agli anni: a mesi, un secolo darebbe
  // milleduecento colonne.
  const anni = conta(36500, [36000, 0]);
  assert.equal(anni.passo, 'anno');
  assert.ok(anni.punti.length <= 120, `colonne: ${anni.punti.length}`);
});

// ── Un lavoro fermo aspetta l'owner, qualunque sia il motivo ────────────────
// I motivi sono sei (FEEDBACK-STATES.md §5) e possono crescere. Tenerne un
// elenco a mano voleva dire, per quelli non elencati, dare per «ancora in
// lavorazione» un lavoro che aspettava una decisione: il contrario del vero,
// sul numero che la segnalazione chiedeva («quanti di questi sono fail»).

for (const motivo of ['loop', 'decisione', 'secaudit', 'l5', 'arenato', 'clarify', 'judges', null]) {
  test(`un lavoro fermo su «${motivo || 'nessun motivo scritto'}» è un lavoro fermo, non uno in corso`, () => {
    const doc = fb({ seq: 7, status: 'design', statusReason: motivo });
    assert.equal(S.fermato(doc), true);
    const r = S.compute({
      range: S.rangeOf('30g', ORA),
      feedbacks: [doc],
      workerLog: [{ role: 'verifier', startedAt: g(1), num: '7' }],
    });
    assert.equal(r.giri.fermati, 1);
    assert.equal(r.giri.aperti, 0);
    assert.deepEqual(r.giri.fette.map((f) => f.key), ['fermati']);
  });
}

// ── Senza la chiave dell'owner il mittente non si inventa ───────────────────

test('un mittente che non si è potuto leggere non diventa «Utente»', () => {
  const cifrato = '[cifrato — chiave privata non configurata]';
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [
      fb({ seq: 1, clientId: cifrato }),
      fb({ seq: 2, clientId: cifrato }),
      fb({ seq: 3, clientId: 'utente-abc' }),
    ],
    workerLog: [],
  });
  assert.equal(S.creatoreDi({ clientId: cifrato }), S.CREATORE_ILLEGGIBILE);
  assert.equal(r.ricevuti.mittentiIgnoti, 2);
  const perKind = Object.fromEntries(r.ricevuti.creatori.map((c) => [c.kind, c.n]));
  assert.equal(perKind.user, 1, 'solo la segnalazione con un mittente leggibile è un utente');
  assert.equal(perKind[S.CREATORE_ILLEGGIBILE], 2);
  // E non entra fra le categorie filtrabili: non si filtra per «non lo so».
  assert.equal(S.CREATORI.includes(S.CREATORE_ILLEGGIBILE), false);
});

// ── Ogni numero che ha contato segnalazioni porta i suoi id ─────────────────

test('i numeri della fila in fondo portano gli id delle segnalazioni che hanno contato', () => {
  const trovato = fb({ seq: 1, clientId: 'agent:prober', _id: 'p1' });
  const lavorato = fb({
    seq: 2, _id: 'w1', status: 'done', createdAt: g(4), reviewedAt: g(3),
    stalls: 2, livelli: { l4: { esito: 'pass' } },
  });
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [trovato, lavorato],
    workerLog: [
      { role: 'prober', startedAt: g(2) },
      { role: 'new-work', startedAt: g(3), num: '2' },
      { role: 'verifier', startedAt: g(1), num: '2' },
    ],
  });
  assert.deepEqual(r.prober.ritrovamentiIds, ['p1']);
  assert.deepEqual(r.auditIds.pass, ['w1']);
  assert.deepEqual(r.arenati.ids, ['w1']);
  assert.deepEqual(r.tempi.presaInCarico.ids, ['w1']);
  assert.deepEqual(r.tempi.lavorazione.ids, ['w1']);
});

test('un lavoro senza nessuna verifica non entra nella torta', () => {
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [fb({ seq: 1, status: 'working' })],
    workerLog: [{ role: 'new-work', startedAt: g(1), num: '1' }],
  });
  assert.equal(r.lavorati.totale, 1);
  assert.equal(r.giri.fette.length, 0);
  assert.equal(r.giri.media, null);
});

test('il filtro per creatore vale anche sui numeri che arrivano dal registro', () => {
  const lista = [
    fb({ seq: 1, clientId: 'agent:prober', status: 'done' }),
    fb({ seq: 2, clientId: 'utente-abc', status: 'done' }),
  ];
  const log = [
    { role: 'verifier', startedAt: g(2), num: '1' },
    { role: 'verifier', startedAt: g(2), num: '2' },
  ];
  const soloProber = S.compute({
    range: S.rangeOf('30g', ORA), feedbacks: lista, workerLog: log, creatori: ['prober'],
  });
  assert.equal(soloProber.lavorati.totale, 1);
  // Un numero che il registro cita ma che la lista non ha: col filtro attivo
  // resta fuori (non si sa di chi è), senza filtro si conta.
  const orfano = [{ role: 'verifier', startedAt: g(2), num: '999' }];
  assert.equal(S.compute({ range: S.rangeOf('30g', ORA), feedbacks: lista, workerLog: orfano, creatori: ['prober'] }).lavorati.totale, 0);
  assert.equal(S.compute({ range: S.rangeOf('30g', ORA), feedbacks: lista, workerLog: orfano }).lavorati.totale, 1);
});

// ── Tempi ───────────────────────────────────────────────────────────────────

test('il tempo di presa in carico è la mediana fra invio e revisione dell\'owner', () => {
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [
      fb({ seq: 1, createdAt: g(10), reviewedAt: g(8) }),   // 2 giorni
      fb({ seq: 2, createdAt: g(10), reviewedAt: g(6) }),   // 4 giorni
      fb({ seq: 3, createdAt: g(10) }),                     // mai presa in mano
    ],
    workerLog: [],
  });
  assert.equal(r.tempi.presaInCarico.n, 2);
  assert.equal(r.tempi.presaInCarico.mediana, 3 * 24 * 3600 * 1000);
});

test('durata: si legge come la direbbe una persona', () => {
  assert.equal(S.durata(null), '—');
  assert.equal(S.durata(30 * 1000), '30 s');
  assert.equal(S.durata(20 * 60 * 1000), '20 min');
  assert.equal(S.durata(5 * 3600 * 1000), '5 ore');
  assert.equal(S.durata(3 * 24 * 3600 * 1000), '3 giorni');
});

// ── Copertura ───────────────────────────────────────────────────────────────

test('il registro dichiara da dove parte invece di far passare un minimo per un totale', () => {
  const r = S.compute({
    range: S.rangeOf('90g', ORA),
    feedbacks: [],
    workerLog: [
      { role: 'prober', startedAt: g(3), num: '' },
      { role: 'prober', startedAt: g(10), num: '' },
    ],
  });
  assert.equal(r.copertura.logVuoto, false);
  assert.equal(r.copertura.logCorto, true);         // 90 giorni chiesti, 10 coperti
  assert.equal(r.copertura.logDa, new Date(g(10)).getTime());
  assert.equal(r.copertura.logA, new Date(g(3)).getTime());

  const stretto = S.compute({ range: S.rangeOf('oggi', ORA), feedbacks: [], workerLog: [{ role: 'prober', startedAt: g(10), num: '' }] });
  assert.equal(stretto.copertura.logCorto, false); // la finestra sta dentro il registro
});

test('registro vuoto: lo dice, non finge zero lanci', () => {
  const r = S.compute({ range: S.rangeOf('7g', ORA), feedbacks: [], workerLog: [] });
  assert.equal(r.copertura.logVuoto, true);
  assert.equal(r.prober.lanciati, 0);
});

test('il tetto del caricamento dei feedback si propaga nella copertura', () => {
  const r = S.compute({ range: S.rangeOf('tutto', ORA), feedbacks: [], workerLog: [], feedbackParziali: true });
  assert.equal(r.copertura.feedbackParziali, true);
});

// ── Robustezza ──────────────────────────────────────────────────────────────

test('regge liste vuote, voci storte e chiavi ostili', () => {
  const r = S.compute({});
  assert.equal(r.ricevuti.totale, 0);
  assert.equal(r.lavorati.totale, 0);
  const sporco = S.compute({
    range: S.rangeOf('tutto', ORA),
    feedbacks: [null, {}, fb({ seq: 0 }), fb({ clientId: '__proto__' })],
    workerLog: [null, 'ciao', { role: 'verifier' }, { role: 'verifier', startedAt: 'boh', num: '1' }],
  });
  assert.ok(sporco.ricevuti.totale >= 0);
  assert.equal(sporco.lavorati.totale, 0);
});

test('la serie temporale raggruppa quando la finestra è lunga', () => {
  const tanti = [];
  for (let i = 0; i < 120; i += 1) tanti.push(fb({ seq: i + 1, createdAt: g(i) }));
  const breve = S.compute({ range: S.rangeOf('30g', ORA), feedbacks: tanti, workerLog: [] });
  assert.equal(breve.ricevuti.serie.passo, 'giorno');
  const lunga = S.compute({ range: S.rangeOf('90g', ORA), feedbacks: tanti, workerLog: [] });
  assert.equal(lunga.ricevuti.serie.passo, 'settimana');
});

test('senza i moduli condivisi il conto si ferma dicendo cosa manca', () => {
  const salvato = globalThis.SN_FEEDBACK_THREAD;
  globalThis.SN_FEEDBACK_THREAD = null;
  try {
    assert.throws(() => S.compute({ range: S.rangeOf('7g', ORA), feedbacks: [fb()], workerLog: [] }),
      /SN_FEEDBACK_THREAD/);
  } finally {
    globalThis.SN_FEEDBACK_THREAD = salvato;
  }
});

// ── Il conto della sezione della torta torna sempre (giro 18) ───────────────
//
// Ogni lavorazione contata dal riquadro «Feedback lavorati» deve uscire da una
// sola porta: una fetta, i fermati, quelle ancora in mezzo al giro, o una
// delle due caselle del «non si sa». Prima si scartava in silenzio ogni
// lavorazione senza una partenza del verificatore, cioè ogni lavoro in mano
// alla correzione in quel momento.

const quadra = (r) => r.giri.fette.reduce((s, f) => s + f.n, 0)
  + r.giri.aperti + r.giri.ignoti + r.giri.senzaGiri + r.giri.statoIgnoto;

test('una lavorazione mai verificata è «ancora in mezzo al giro», non sparisce', () => {
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [
      fb({ seq: 1, status: 'done' }),       // finito dopo due verifiche
      fb({ seq: 2, status: 'working' }),    // in mano alla correzione: mai verificato
      fb({ seq: 3, status: 'revision_capability' }),
    ],
    workerLog: [
      { role: 'new-work', startedAt: g(3), num: '1' },
      { role: 'verifier', startedAt: g(3), num: '1' },
      { role: 'verifier', startedAt: g(2), num: '1' },
      { role: 'new-work', startedAt: g(2), num: '2' },
      { role: 'fixer',    startedAt: g(1), num: '2' },
      { role: 'new-work', startedAt: g(2), num: '3' },
      { role: 'verifier', startedAt: g(1), num: '3' },
    ],
  });
  assert.equal(r.lavorati.totale, 3);
  assert.equal(r.giri.aperti, 2, '#2 e #3 sono tutti e due in mezzo al giro');
  assert.equal(r.giri.apertiIds.length, 2);
  assert.equal(quadra(r), r.lavorati.totale, 'la sezione della torta rende conto di tutte le lavorazioni');
});

test('un lavoro passato le cui verifiche il registro non conserva si dichiara, non si conta come passato subito', () => {
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [fb({ seq: 1, status: 'done' })],
    // Solo l'audit di sicurezza è rimasto nel registro: le verifiche sono più
    // vecchie e il registro tiene le ultime.
    workerLog: [{ role: 'secaudit', startedAt: g(1), num: '1' }],
  });
  assert.equal(r.lavorati.totale, 1);
  assert.equal(r.giri.fette.length, 0, 'nessuna fetta: quanto è costato non si sa');
  assert.equal(r.giri.media, null);
  assert.equal(r.giri.senzaGiri, 1);
  assert.equal(r.giri.senzaGiriIds.length, 1);
  assert.equal(quadra(r), r.lavorati.totale);
});

test('una lavorazione che la lista non ha si conta fra gli ignoti anche senza verifiche', () => {
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [],
    workerLog: [{ role: 'fixer', startedAt: g(1), num: '777' }],
  });
  assert.equal(r.lavorati.totale, 1);
  assert.equal(r.giri.ignoti, 1);
  assert.equal(quadra(r), r.lavorati.totale);
});

// ── Il filtro per mittente vale anche sui ritrovamenti (giro 18) ────────────

test('con l\'esploratore fuori dal filtro, le sue segnalazioni non si contano più', () => {
  const dati = {
    feedbacks: [
      fb({ seq: 1, clientId: 'routine:prober' }),
      fb({ seq: 2, clientId: 'routine:prober' }),
      fb({ seq: 3, clientId: 'persona@x.it' }),
    ],
    workerLog: [{ role: 'prober', startedAt: g(1), num: '' }],
  };
  const tutti = S.compute(Object.assign({ range: S.rangeOf('30g', ORA) }, dati));
  assert.equal(tutti.prober.ritrovamenti, 2);
  assert.equal(tutti.prober.ritrovamentiIds.length, 2);

  const solePersone = S.compute(Object.assign({ range: S.rangeOf('30g', ORA), creatori: ['user'] }, dati));
  assert.equal(solePersone.prober.ritrovamenti, 0);
  assert.equal(solePersone.prober.ritrovamentiIds.length, 0);
  // Il NUMERO GRANDE del riquadro resta: una partenza dell'esploratore non ha
  // un mittente, e il filtro non la tocca.
  assert.equal(solePersone.prober.lanciati, 1);

  const soloEsploratore = S.compute(Object.assign({ range: S.rangeOf('30g', ORA), creatori: ['prober'] }, dati));
  assert.equal(soloEsploratore.prober.ritrovamenti, 2);
});

// ── I gruppi del filtro coprono tutti i mittenti, una volta sola (giro 18) ──

test('le pasticche di gruppo coprono esattamente i mittenti, senza doppioni', () => {
  const tutti = S.GRUPPI_CREATORI.flatMap((g2) => g2.kinds);
  assert.equal(tutti.length, new Set(tutti).size, 'un mittente in due gruppi');
  assert.deepEqual(tutti.slice().sort(), S.CREATORI.slice().sort(),
    'i gruppi devono coprire tutti i mittenti e nessuno in più');
  for (const gr of S.GRUPPI_CREATORI) assert.ok(gr.key.startsWith('__'), 'la chiave di un gruppo non è un mittente');
});

// ── Senza la chiave dell'owner: lo stato non si legge, e non si indovina ────
// (giro 19)
//
// Lo status viaggia cifrato. Su un computer senza la chiave privata la scheda
// dichiara già «Non leggibile con questa chiave» dove divide per categoria;
// mettere lo stesso lavoro fra quelli «ancora in mezzo al giro» era
// un'affermazione su ciò che la riga accanto dichiarava di non sapere, e su un
// lavoro già chiuso è il contrario del vero.

const CIFRATO = 'FENC1:' + 'q'.repeat(48);

test('un lavoro con lo stato cifrato non finisce fra quelli ancora in mezzo al giro', () => {
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [fb({ seq: 1, status: CIFRATO, statusPublic: 'closed' })],
    workerLog: [
      { role: 'new-work', startedAt: g(3), num: '1' },
      { role: 'verifier', startedAt: g(2), num: '1' },
    ],
  });
  assert.equal(r.lavorati.totale, 1);
  assert.equal(r.giri.statoIgnoto, 1, 'lo stato illeggibile va contato a parte');
  assert.equal(r.giri.statoIgnotoIds.length, 1);
  assert.equal(r.giri.aperti, 0, 'non si può dire che è ancora in mezzo al giro');
  assert.equal(r.giri.fette.reduce((s, f) => s + f.n, 0), 0, 'e nemmeno metterlo in una fetta');
  assert.equal(r.giri.media, null);
  // Il conto della sezione torna lo stesso: niente sparisce in silenzio.
  assert.equal(quadra(r), r.lavorati.totale);
});

test('con la chiave lo stesso lavoro torna in una fetta', () => {
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [fb({ seq: 1, status: 'done' })],
    workerLog: [
      { role: 'new-work', startedAt: g(3), num: '1' },
      { role: 'verifier', startedAt: g(2), num: '1' },
    ],
  });
  assert.equal(r.giri.statoIgnoto, 0);
  assert.equal(r.giri.fette.reduce((s, f) => s + f.n, 0), 1);
});

// ── Un'esecuzione senza mestiere scritto resta nel conto (giro 19) ──────────

test('un lancio senza mestiere si conta lo stesso, in una voce sua', () => {
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [],
    workerLog: [
      { role: 'new-work', startedAt: g(2), num: '1' },
      { role: 'prober', startedAt: g(2) },
      { startedAt: g(1) },
    ],
  });
  assert.equal(r.lanci.totale, 3, 'il riquadro promette tutte le esecuzioni, di qualunque mestiere');
  const somma = r.lanci.perRuolo.reduce((s, v) => s + v.n, 0);
  assert.equal(somma, r.lanci.totale, 'la divisione per mestiere deve rendere conto del totale');
  assert.ok(r.lanci.perRuolo.some((v) => v.role === ''), 'la voce senza mestiere deve esserci');
});

// ── Il registro che non si è letto non è un registro vuoto (giro 20) ────────
//
// Se la lettura del registro fallisce, «quante lavorazioni» non è zero: è una
// domanda senza risposta. Uno zero in mezzo alla pagina si legge «non è
// partito niente», il contrario di «non lo so», e la riga piccola sopra i
// riquadri non basta a disdirlo. Quindi i numeri che vengono dal registro
// escono `null`, e chi disegna scrive un trattino come già fa per le durate.

test('registro non letto: i numeri che ne vengono sono null, non zero', () => {
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [fb({ seq: 1, status: 'done' }), fb({ seq: 2, status: 'todo' })],
    workerLog: [],
    registroLetto: false,
  });
  assert.equal(r.copertura.registroLetto, false);
  assert.equal(r.lavorati.totale, null);
  assert.equal(r.lavorati.verifiche, null);
  assert.equal(r.lanci.totale, null);
  assert.equal(r.prober.lanciati, null);
  assert.equal(r.giri.fermati, null);
  assert.equal(r.giri.rimandati, null);
  assert.equal(r.giri.aperti, null);
  assert.equal(r.audit.pass, null);
  assert.equal(r.arenati.lavorazioni, null);
  assert.equal(r.tempi.lavorazione.mediana, null);
  // Quello che NON viene dal registro si sa lo stesso e resta un numero.
  assert.equal(r.ricevuti.totale, 2);
  assert.equal(r.prober.ritrovamenti, 0);
});

test('registro letto e vuoto: quelli sono zeri veri', () => {
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [fb({ seq: 1, status: 'done' })],
    workerLog: [],
  });
  assert.equal(r.copertura.registroLetto, true);
  assert.equal(r.lavorati.totale, 0);
  assert.equal(r.lanci.totale, 0);
  assert.equal(r.giri.fermati, 0);
});

// ── «Passati lasciando indietro dei rilievi» (giro 20) ──────────────────────
//
// Dipende dall'ESITO del lavoro e dalla segnalazione derivata, non dal fatto
// che il lavoro entri nella torta. Contandolo in coda al ramo che disegna la
// fetta sbagliava da tutte e due le parti.

test('un lavoro fermato non è anche «passato lasciando indietro dei rilievi»', () => {
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [
      fb({ seq: 10, status: 'design' }),
      fb({ seq: 10, subSeq: 1, clientId: 'routine:residuo', status: 'todo' }),
    ],
    workerLog: [
      { role: 'new-work', startedAt: g(3), num: '10' },
      { role: 'verifier', startedAt: g(2), num: '10' },
    ],
  });
  assert.equal(r.giri.fermati, 1);
  assert.equal(r.giri.rimandati, 0, 'lo stesso lavoro non può essere insieme fermato e passato');
});

test('un lavoro passato con rilievi lasciati indietro si conta anche se le sue verifiche sono più vecchie del registro', () => {
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [
      fb({ seq: 11, status: 'done', createdAt: g(40) }),
      fb({ seq: 11, subSeq: 1, clientId: 'routine:residuo', status: 'todo', createdAt: g(40) }),
    ],
    // Il registro conserva solo l'ultima lavorazione: le verifiche non ci sono più.
    workerLog: [{ role: 'fixer', startedAt: g(2), num: '11' }],
  });
  assert.equal(r.giri.senzaGiri, 1, 'il lavoro sta fuori dalla torta perché i suoi giri non si sanno');
  assert.equal(r.giri.rimandati, 1, 'ma è passato e ha lasciato indietro dei rilievi: si conta');
  assert.equal(r.giri.rimandatiIds.length, 1);
});

// ── Le date illeggibili rispettano il filtro per mittente (giro 20) ─────────

test('le segnalazioni senza data leggibile si contano solo se passano il filtro', () => {
  const dati = {
    range: S.rangeOf('30g', ORA),
    feedbacks: [
      fb({ seq: 20, clientId: 'utente-xyz' }),
      fb({ seq: 21, clientId: 'routine:fixer', createdAt: 'non-una-data' }),
    ],
    workerLog: [],
  };
  assert.equal(S.compute(dati).ricevuti.senzaData, 1, 'senza filtro si contano tutte');
  const solePersone = S.compute({ ...dati, creatori: ['owner', 'user', 'filo'] });
  assert.equal(solePersone.ricevuti.senzaData, 0, 'quella segnalazione l\'ha mandata una routine');
});

test('segnalazioni non lette: anche i loro numeri sono null, non zero', () => {
  const r = S.compute({
    range: S.rangeOf('30g', ORA),
    feedbacks: [],
    feedbackLetti: false,
    workerLog: [{ role: 'prober', startedAt: g(1) }],
  });
  assert.equal(r.copertura.feedbackLetti, false);
  assert.equal(r.ricevuti.totale, null);
  assert.equal(r.prober.ritrovamenti, null);
  assert.equal(r.tempi.presaInCarico.mediana, null);
  // Il registro invece ha risposto: quei numeri si sanno.
  assert.equal(r.prober.lanciati, 1);
  assert.equal(r.lanci.totale, 1);
});

// ── Un anno di una o due cifre non è il Novecento ───────────────────────────
// `new Date(1, 0, 1)` non è il 1° gennaio dell'anno 1: il costruttore mappa gli
// anni da 0 a 99 sul Novecento e dà il 1901. Con una finestra scritta a mano
// che parte dall'anno 0001, la riga sopra il grafico scriveva «dal 1/1/1» e la
// prima colonna si chiamava «1901»: due date diverse per la stessa cosa, sulla
// stessa schermata.

test('la serie degli arrivi chiama gli anni col loro nome, anche sotto il cento', () => {
  const r = S.rangeOf('custom', ORA, { da: '0001-01-01', a: '2026-12-31' });
  const serie = S.serieTemporale([{ t: new Date('2026-06-15T10:00:00Z').getTime(), id: 'x' }], r);
  assert.equal(serie.passo, 'anno', 'con una finestra di duemila anni il passo è l\'anno');
  assert.equal(serie.punti[0].label, '1', `la prima colonna si chiama «${serie.punti[0].label}»`);
  assert.equal(serie.punti[serie.punti.length - 1].label, '2026');
  // E la colonna che contiene la segnalazione è quella giusta.
  const piena = serie.punti.filter((p) => p.n > 0);
  assert.equal(piena.length, 1);
  assert.equal(piena[0].label, '2026');
});

test('anche col passo al giorno un anno sotto il cento resta quello scritto', () => {
  const r = S.rangeOf('custom', ORA, { da: '0042-03-01', a: '0042-03-05' });
  const serie = S.serieTemporale([{ t: new Date('0042-03-02T10:00:00Z').getTime(), id: 'y' }], r);
  assert.equal(serie.passo, 'giorno');
  assert.ok(
    serie.punti.every((p) => /\/42$/.test(p.label)),
    `le colonne non sono dell'anno 42: ${serie.punti.map((p) => p.label).join(', ')}`,
  );
});
