// Unit test per src/shared/feedbackStats.js — i conti della scheda
// "Statistiche feedback" della dashboard di gestione (#496).
//
// Quello che si prova qui: la finestra di riferimento (comprese le date
// personalizzate scritte male), il filtro per creatore, le categorie, la
// lettura dei giri di verifica dalle note (formato di oggi e storico), e le
// dichiarazioni di onestà — copertura parziale del caricamento, lavorazioni
// senza verbale di verifica.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED = join(__dirname, '..', '..', 'src', 'shared');
require(join(SHARED, 'feedbackTransitions.js'));
require(join(SHARED, 'feedbackStatus.js'));
require(join(SHARED, 'manageReview.js'));
require(join(SHARED, 'feedbackThread.js'));
require(join(SHARED, 'verifierRound.js'));
require(join(SHARED, 'feedbackStats.js'));

const ST = globalThis.SN_FEEDBACK_STATS;

const NOW = new Date('2026-09-08T12:00:00Z').getTime();
const GIORNO = 24 * 3600 * 1000;

function fb(over) {
  return Object.assign({
    _id: 'x', seq: 1, clientId: 'utente-1', status: 'todo',
    createdAt: new Date(NOW - GIORNO).toISOString(),
  }, over || {});
}

test('si registra su globalThis con la sua API', () => {
  assert.ok(ST);
  for (const fn of ['compute', 'windowRange', 'parseRounds', 'loopsBeforePass', 'categoryOf']) {
    assert.equal(typeof ST[fn], 'function', `manca ${fn}`);
  }
});

// ─── La finestra di riferimento ──────────────────────────────────────────────

test('windowRange: le finestre pronte partono da adesso e finiscono adesso', () => {
  const r = ST.windowRange({ key: '7d' }, NOW);
  assert.equal(r.valid, true);
  assert.equal(r.to, NOW);
  assert.equal(r.from, NOW - 7 * GIORNO);
});

test('windowRange: "Sempre" non ha estremi', () => {
  const r = ST.windowRange({ key: 'all' }, NOW);
  assert.equal(r.from, null);
  assert.equal(r.to, null);
  assert.equal(r.valid, true);
});

test('windowRange: la finestra personalizzata prende il giorno INTERO', () => {
  const r = ST.windowRange({ key: 'custom', from: '2026-09-01', to: '2026-09-01' }, NOW);
  assert.equal(r.valid, true);
  const from = new Date(r.from), to = new Date(r.to);
  assert.equal(from.getHours(), 0);
  assert.equal(to.getHours(), 23);
  assert.ok(to.getTime() - from.getTime() > 23 * 3600 * 1000, 'copre tutte le ore del giorno');
});

test('windowRange: date illeggibili, inesistenti o al contrario NON valgono zero, valgono "non valida"', () => {
  assert.equal(ST.windowRange({ key: 'custom', from: 'la settimana scorsa' }, NOW).valid, false);
  assert.equal(ST.windowRange({ key: 'custom', from: '2026-02-31' }, NOW).valid, false);
  assert.equal(ST.windowRange({ key: 'custom', from: '2026-09-08', to: '2026-09-01' }, NOW).valid, false);
  assert.equal(ST.windowRange({ key: 'custom' }, NOW).valid, false, 'senza date non è ancora una finestra');
});

// ─── Ricevuti, categorie, creatori ───────────────────────────────────────────

test('compute: conta i ricevuti per DATA D\'ARRIVO dentro la finestra', () => {
  const lista = [
    fb({ _id: 'a', createdAt: new Date(NOW - 2 * GIORNO).toISOString() }),
    fb({ _id: 'b', createdAt: new Date(NOW - 20 * GIORNO).toISOString() }),
  ];
  const r = ST.compute({ feedbacks: lista, sel: { key: '7d' }, now: NOW });
  assert.equal(r.ricevuti.total, 1);
  const tutti = ST.compute({ feedbacks: lista, sel: { key: '30d' }, now: NOW });
  assert.equal(tutti.ricevuti.total, 2);
});

test('compute: la ripartizione per categoria copre tutte le voci e somma al totale', () => {
  const lista = [
    fb({ _id: 'a', status: 'todo' }),
    fb({ _id: 'b', status: 'attack' }),
    fb({ _id: 'c', status: 'attack_confirmed' }),
    fb({ _id: 'd', status: 'spam' }),
    fb({ _id: 'e', status: 'design' }),
    fb({ _id: 'f', status: 'unlabeled' }),
    fb({ _id: 'g', status: 'suspicious_file' }),
  ];
  const r = ST.compute({ feedbacks: lista, sel: { key: '7d' }, now: NOW });
  const per = Object.fromEntries(r.ricevuti.perCategoria.map((c) => [c.key, c.n]));
  assert.equal(per.valida, 1);
  assert.equal(per.attacco, 2, 'l\'attacco confermato sta con gli attacchi');
  assert.equal(per.spam, 1);
  assert.equal(per.design, 1);
  assert.equal(per.da_filtrare, 1);
  assert.equal(per.file, 1);
  const somma = r.ricevuti.perCategoria.reduce((a, c) => a + c.n, 0);
  assert.equal(somma, r.ricevuti.total, 'nessuna segnalazione fuori da ogni categoria');
});

test('compute: il filtro per creatore tiene solo quelli scelti, ma i conteggi delle caselle restano interi', () => {
  const lista = [
    fb({ _id: 'a', clientId: 'routine:prober' }),
    fb({ _id: 'b', clientId: 'routine:verifier' }),
    fb({ _id: 'c', clientId: 'utente-7' }),
  ];
  const r = ST.compute({ feedbacks: lista, sel: { key: '7d' }, creators: ['prober'], now: NOW });
  assert.equal(r.ricevuti.total, 1, 'solo l\'esploratore');
  const per = Object.fromEntries(r.creatori.map((c) => [c.key, c.n]));
  assert.equal(per.prober, 1);
  assert.equal(per.verifier, 1, 'la casella spenta dice comunque quante ne conterrebbe');
  assert.equal(per.user, 1);
});

// ─── Lavorati ────────────────────────────────────────────────────────────────

test('compute: "lavorati" sono le lavorazioni CHIUSE, con l\'ultimo movimento nella finestra', () => {
  const lista = [
    fb({ _id: 'chiuso', status: 'done', createdAt: new Date(NOW - 5 * GIORNO).toISOString(), _updateTime: new Date(NOW - GIORNO).toISOString() }),
    fb({ _id: 'chiuso-vecchio', status: 'done', createdAt: new Date(NOW - 60 * GIORNO).toISOString(), _updateTime: new Date(NOW - 40 * GIORNO).toISOString() }),
    fb({ _id: 'in-coda', status: 'todo' }),
    fb({ _id: 'archiviato-mai-lavorato', status: 'archived', _updateTime: new Date(NOW - GIORNO).toISOString() }),
  ];
  const r = ST.compute({ feedbacks: lista, sel: { key: '7d' }, now: NOW });
  assert.equal(r.lavorati.total, 1);
  assert.equal(ST.formatDuration(r.lavorati.tempoMediano), '4 g');
});

test('compute: un archiviato CON la versione di uscita è stato lavorato', () => {
  const lista = [fb({ _id: 'z', status: 'archived', resolvedInVersion: '1.2.3', _updateTime: new Date(NOW - GIORNO).toISOString() })];
  const r = ST.compute({ feedbacks: lista, sel: { key: '7d' }, now: NOW });
  assert.equal(r.lavorati.total, 1);
});

test('compute: l\'istantanea "adesso" non guarda la finestra', () => {
  const lista = [
    fb({ _id: 'a', status: 'working', createdAt: new Date(NOW - 300 * GIORNO).toISOString() }),
    fb({ _id: 'b', status: 'todo', createdAt: new Date(NOW - 300 * GIORNO).toISOString() }),
  ];
  const r = ST.compute({ feedbacks: lista, sel: { key: '24h' }, now: NOW });
  assert.equal(r.ricevuti.total, 0);
  assert.equal(r.adesso.inLavorazione, 1);
  assert.equal(r.adesso.inCoda, 1);
});

// ─── I giri di verifica letti dalle note ─────────────────────────────────────

// ⚠️ OGNI NOTA È UN TURNO. Filo appende una nota per volta, ognuna col suo
// marcatore (SN_FEEDBACK_THREAD.appendModelTurn): il report di chi lavora e il
// verbale del verificatore non stanno mai nello stesso turno. Le note finte
// scritte in un blocco solo raccontavano una conversazione che Filo non scrive.
const TURNO = (h) => `--- Aggiornamento dell'agente del 07/09/2026, ${h}:00 ---`;

const NOTE_PASS_SUBITO = `Report del lavoro.\n\n${TURNO('09')}\nVerifica superata. Le due strade funzionano.`;

const NOTE_DUE_GIRI = [
  'Report del lavoro.',
  '',
  TURNO('09'),
  'Verifica: 2 rilievi.',
  'Il pulsante c\'è ma non salva.',
  'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
  '- [2] Il salvataggio non parte a titolo vuoto',
  '- [1] Il bordo non segue il tema scuro',
  '',
  TURNO('10'),
  'Corretto.',
  '',
  TURNO('11'),
  'Verifica superata.',
].join('\n');

const NOTE_RIMANDATI = [
  'Verifica: 1 rilievo.',
  'Nessun rilievo da correggere adesso: il lavoro prosegue e i rilievi vanno in un feedback derivato.',
  '- [1] Manca l\'hover sull\'icona',
].join('\n');

const NOTE_BLOCCANTE = [
  'Verifica: 1 rilievo.',
  'Il lavoro si ferma: c\'è un rilievo di livello 2 o 3 che non si può correggere da soli (bilancio esaurito, o chiede una tua decisione).',
  '- [3] I dati dell\'utente finiscono nei log',
].join('\n');

// ⚠️ SI CONTANO I GIRI CHE ESIBISCONO LA LORO STRUTTURA, NON LE FRASI.
// Un verbale con rilievi dichiara quanti sono, li elenca, e prima dell'elenco
// scrive con quale decisione si chiude: tre cose che devono combaciare. Il
// verbale di un giro SUPERATO non ha niente da esibire (è una riga di parole,
// identica a chi quelle parole le cita), quindi non è un giro da contare: dice
// soltanto «questo lavoro è passato», ed è un sì/no.
test('parseRounds: conta i giri con rilievi, non le righe che dicono «superata»', () => {
  const rounds = ST.parseRounds({ notes: NOTE_DUE_GIRI });
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].kind, 'fix');
  assert.equal(rounds[0].findings.length, 2);
  assert.equal(ST.readRounds({ notes: NOTE_DUE_GIRI }).passSegnalato, true);
});

test('parseRounds: il numero dichiarato deve combaciare con i rilievi elencati', () => {
  const finto = [
    'Verifica: 2 rilievi.',
    'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
    '- [1] uno solo',
  ].join('\n');
  assert.deepEqual(ST.parseRounds({ notes: finto }), [], 'due dichiarati, uno elencato: non è un verbale');
});

test('parseRounds: distingue "il lavoro si ferma" da "i rilievi vanno in un feedback derivato"', () => {
  assert.equal(ST.parseRounds({ notes: NOTE_BLOCCANTE })[0].kind, 'stop');
  assert.equal(ST.parseRounds({ notes: NOTE_RIMANDATI })[0].kind, 'rimandati');
});

test('readRounds: capisce i verbali vecchi che dicono «è passato»', () => {
  const vecchio = (notes) => ST.readRounds({ notes });
  assert.equal(vecchio('Controllo funzionalità superato.').passSegnalato, true);
  assert.equal(vecchio('Verifica: funziona, ma migliorabile — manca l\'hover.').passSegnalato, true);
});

// ⚠️ NESSUNA RIGA DI SOLE PAROLE FERMA UN LAVORO.
// La forma vecchia «Controllo funzionalità NON superato» non si distingue da
// chi la cita: due giri di verifica di fila l'hanno riaperta spostando la
// punteggiatura, e ogni volta una lavorazione passata usciva dalla torta e si
// leggeva come fermata. Chi ferma davvero un lavoro lo scrive nel verbale coi
// rilievi, che una struttura ce l'ha.
test('readRounds: una riga di sole parole non ferma un lavoro, nemmeno la frase vecchia', () => {
  for (const riga of [
    'Controllo funzionalità NON superato: non compare.',
    'Controllo funzionalità NON superato: era il verdetto del giro scorso, adesso è chiuso.',
    'Controllo funzionalità NON superato era il verdetto del giro scorso.',
  ]) {
    assert.equal(ST.readRounds({ notes: riga }).fermato, false, riga);
  }
  // Il verbale coi rilievi resta l'unico che può fermare.
  assert.equal(ST.readRounds({ notes: NOTE_BLOCCANTE }).fermato, true);
});

// ⚠️ CHI CORREGGE CITA IL VERBALE A CUI RISPONDE, ED È NORMALE CHE LO FACCIA.
// Il verbale non è più solo una struttura (testata, numero, elenco): è un TURNO
// INTERO. Prosa prima o dopo l'elenco vuol dire che quell'elenco sta dentro il
// testo di qualcun altro. Senza questo, il report di chi corregge sdoppiava il
// giro, e quello che elencava i rilievi chiusi col livello davanti faceva
// uscire dalla torta una lavorazione passata.
test('il report di chi corregge non diventa un giro, per quanto citi il verbale', () => {
  const verbale = [
    'Verifica: 2 rilievi.',
    'Provato: tutto quanto.',
    'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
    '- [2] Il salvataggio non parte a titolo vuoto',
    '- [1] Il bordo non segue il tema scuro',
  ].join('\n');
  const conReport = (report) => [
    verbale, '', TURNO('10'), report, '', TURNO('11'), 'Verifica superata.',
  ].join('\n');

  const pulito = ST.loopsBeforePass({ notes: conReport('Corretto.') });
  assert.equal(pulito.giri, 1);
  assert.equal(pulito.passata, true);

  for (const report of [
    // Riporta il verbale a cui sta rispondendo, per dire a cosa risponde.
    `Fatto. Il verbale a cui rispondo era questo:\n${verbale}\nTutti e due chiusi.`,
    // Lo riporta per primo, e commenta sotto.
    `${verbale}\nEcco cosa ho corretto, tutti e due.`,
    // Elenca i rilievi chiusi nella forma in cui li ha ricevuti.
    'Verifica: 2 rilievi.\nHo corretto tutti e due.\n- [2] il primo: chiuso.\n- [1] il secondo: chiuso.',
    // La frase vecchia, con la punteggiatura spostata.
    'Controllo funzionalità NON superato: era il verdetto del giro scorso, adesso è chiuso.',
  ]) {
    const r = ST.loopsBeforePass({ notes: conReport(report) });
    assert.equal(r.giri, 1, report);
    assert.equal(r.passata, true, report);
    assert.equal(r.rounds.filter((x) => x.kind === 'stop').length, 0, report);
  }
});

// ⚠️ LA TESTATA DI UN ALTRO VERBALE, CITATA NEL RIASSUNTO, NON CANCELLA IL GIRO.
// Fra più righe che sembrano un'intestazione vince la PRIMA che è davvero un
// verbale: con l'ultima, «Verifica: 3 rilievi.» riportata a capo dentro il
// riassunto faceva sparire del tutto il giro vero.
test('una testata citata nel riassunto non cancella il giro che la contiene', () => {
  const notes = [
    'Verifica: 2 rilievi.',
    'Provato: tutto. Il giro scorso si apriva così:',
    'Verifica: 3 rilievi.',
    'e quei tre li ho riprovati, sono chiusi.',
    'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
    '- [2] Il primo',
    '- [1] Il secondo',
    '',
    TURNO('10'),
    'Verifica superata.',
  ].join('\n');
  const r = ST.loopsBeforePass({ notes });
  assert.equal(r.giri, 1);
  assert.equal(r.rounds[0].findings.length, 2);
});

// ⚠️ LA TESTA DEL CAMPO NOTE SI SCRIVE A MANO, E NON È UN TURNO DI FILO.
// Filo appende ogni nota col suo marcatore; quello che sta prima del primo
// marcatore lo ha scritto qualcuno nella casella di testo della dashboard. Una
// riga di sole parole lì dentro vale come esito solo se è tutto quello che c'è.
test('una nota scritta a mano sopra altro testo non è un verbale', () => {
  const aMano = 'Verifica superata. Ho guardato io, va bene.\n\nChiusa a mano.';
  assert.equal(ST.loopsBeforePass({ notes: aMano }), null);
  // Un verbale vero scritto lì sotto continua a contare.
  const conVerbale = `Nota mia.\n\n${NOTE_RIMANDATI}`;
  assert.equal(ST.parseRounds({ notes: conVerbale }).length, 1);
});

test('parseRounds: un livello scritto nel report di chi ha lavorato non diventa un rilievo della verifica', () => {
  const notes = [
    'Verifica superata.',
    '',
    '--- Aggiornamento dell\'agente del 07/09/2026, 10:00 ---',
    '- [2] questo è un elenco del report, non un rilievo',
  ].join('\n');
  assert.deepEqual(ST.parseRounds({ notes }), []);
  assert.equal(ST.loopsBeforePass({ notes }).giri, 0);
});

test('parseRounds: note assenti o cifrate → nessun giro (non uno zero inventato)', () => {
  assert.deepEqual(ST.parseRounds({ notes: '' }), []);
  assert.deepEqual(ST.parseRounds({}), []);
  assert.deepEqual(ST.parseRounds({ notes: 'FENC1:abcdef' }), []);
});

// I giri sono le CORREZIONI: quelle che hanno rimandato indietro il lavoro. Un
// giro che chiude coi rilievi rimandati a un feedback derivato lascia
// proseguire, quindi non è un'attesa in più.
test('loopsBeforePass: i giri sono le correzioni chieste prima del pass', () => {
  assert.deepEqual(pick(ST.loopsBeforePass({ notes: NOTE_PASS_SUBITO })), { passata: true, giri: 0 });
  assert.deepEqual(pick(ST.loopsBeforePass({ notes: NOTE_DUE_GIRI })), { passata: true, giri: 1 });
  assert.deepEqual(pick(ST.loopsBeforePass({ notes: NOTE_RIMANDATI })), { passata: true, giri: 0 });
  assert.deepEqual(pick(ST.loopsBeforePass({ notes: NOTE_BLOCCANTE })), { passata: false, giri: 0 });
  assert.equal(ST.loopsBeforePass({ notes: 'nessun verbale qui' }), null);
  function pick(r) { return { passata: r.passata, giri: r.giri }; }
});

test('compute: la torta dei giri, la media e gli esiti dei giri', () => {
  const chiuso = (id, notes) => fb({
    _id: id, status: 'done', notes,
    createdAt: new Date(NOW - 3 * GIORNO).toISOString(),
    _updateTime: new Date(NOW - GIORNO).toISOString(),
  });
  const lista = [
    chiuso('a', NOTE_PASS_SUBITO),   // 0 giri
    chiuso('b', NOTE_PASS_SUBITO),   // 0 giri
    chiuso('c', NOTE_DUE_GIRI),      // 1 giro (una correzione)
    chiuso('d', NOTE_RIMANDATI),     // 0 giri, con rilievi rimandati
    chiuso('e', 'nessun verbale'),   // senza dati
  ];
  const r = ST.compute({ feedbacks: lista, sel: { key: '7d' }, now: NOW });
  assert.equal(r.giri.conDati, 4);
  assert.equal(r.giri.senzaDati, 1, 'chi non ha verbale si dichiara, non si conta come zero');
  assert.deepEqual(r.giri.fette, [{ giri: 0, n: 3 }, { giri: 1, n: 1 }]);
  assert.equal(ST.formatAvg(r.giri.media), '0,3');
  assert.equal(r.giri.perEsito.fix, 1);
  assert.equal(r.giri.perEsito.rimandati, 1);
  assert.equal(r.giri.perEsito.stop, 0);
  assert.equal(r.giri.perEsito.pass, 3);
  assert.equal(r.giri.perLivello[2], 1);
  assert.equal(r.giri.perLivello[1], 2);
  assert.equal(r.giri.alPrimoColpo, 0.75);
});

// ─── Partenze delle routine ──────────────────────────────────────────────────

test('launches: conta per ruolo dentro la finestra e dichiara un registro che non ci arriva', () => {
  const log = [
    { role: 'prober', startedAt: new Date(NOW - 2 * GIORNO).toISOString() },
    { role: 'prober', startedAt: new Date(NOW - 3 * GIORNO).toISOString() },
    { role: 'verifier', startedAt: new Date(NOW - 4 * GIORNO).toISOString() },
    { role: 'prober', startedAt: new Date(NOW - 40 * GIORNO).toISOString() },
  ];
  const dentro = ST.launches(log, ST.windowRange({ key: '7d' }, NOW));
  assert.equal(dentro.prober, 2);
  assert.equal(dentro.total, 3);
  assert.equal(dentro.parziale, false);
  const oltre = ST.launches(log, ST.windowRange({ key: '90d' }, NOW));
  assert.equal(oltre.prober, 3);
  assert.equal(oltre.parziale, true, 'il registro comincia dopo l\'inizio della finestra: è un minimo');
});

// ─── Onestà sui limiti del caricamento ───────────────────────────────────────

test('compute: col caricamento al tetto e la finestra più indietro, i numeri sono un MINIMO', () => {
  const lista = [];
  for (let k = 0; k < 5; k += 1) {
    lista.push(fb({ _id: `n${k}`, createdAt: new Date(NOW - (k + 1) * GIORNO).toISOString() }));
  }
  const pieno = ST.compute({ feedbacks: lista, sel: { key: 'all' }, now: NOW, pageSize: 5 });
  assert.equal(pieno.copertura.tetto, true);
  assert.equal(pieno.copertura.parziale, true);
  const corta = ST.compute({ feedbacks: lista, sel: { key: '24h' }, now: NOW, pageSize: 5 });
  assert.equal(corta.copertura.parziale, false, 'la finestra sta dentro i dati in pagina: il numero è un totale');
  const largo = ST.compute({ feedbacks: lista, sel: { key: 'all' }, now: NOW, pageSize: 500 });
  assert.equal(largo.copertura.parziale, false, 'senza tetto toccato non c\'è niente fuori');
});

test('compute: stato illeggibile (niente chiave) → lo dichiara e la categoria lo dice', () => {
  const lista = [fb({ _id: 'a', status: 'FENC1:xxx' }), fb({ _id: 'b', status: 'FENC1:yyy' })];
  const r = ST.compute({ feedbacks: lista, sel: { key: '7d' }, now: NOW });
  assert.equal(r.statiLeggibili, false);
  const per = Object.fromEntries(r.ricevuti.perCategoria.map((c) => [c.key, c.n]));
  assert.equal(per.illeggibile, 2);
  assert.equal(r.ricevuti.total, 2, 'quante ne sono arrivate si sa lo stesso');
});

// ─── Il grafico nel tempo ────────────────────────────────────────────────────

test('timeline: colonne per giorno su una finestra corta, e nessun buco nella serie', () => {
  const lista = [
    fb({ _id: 'a', createdAt: new Date(NOW - GIORNO).toISOString() }),
    fb({ _id: 'b', createdAt: new Date(NOW - GIORNO).toISOString() }),
    fb({ _id: 'c', createdAt: new Date(NOW - 3 * GIORNO).toISOString() }),
  ];
  const t = ST.timeline(lista, ST.windowRange({ key: '7d' }, NOW), NOW);
  assert.equal(t.unit, 'giorno');
  assert.ok(t.buckets.length >= 7 && t.buckets.length <= 9);
  assert.equal(t.buckets.reduce((a, b) => a + b.n, 0), 3);
});

test('timeline: finestra lunga → si passa a settimane e poi a mesi, mai a mille colonne', () => {
  const lista = [fb({ _id: 'a', createdAt: new Date(NOW - 100 * GIORNO).toISOString() })];
  const set = ST.timeline(lista, ST.windowRange({ key: '90d' }, NOW), NOW);
  assert.equal(set.unit, 'settimana');
  assert.ok(set.buckets.length <= 66);
  const mesi = ST.timeline(lista, { from: NOW - 2000 * GIORNO, to: NOW, valid: true }, NOW);
  assert.equal(mesi.unit, 'mese');
  assert.ok(mesi.buckets.length <= 66);
});

test('formatDuration: come lo direbbe una persona', () => {
  assert.equal(ST.formatDuration(42 * 60 * 1000), '42 min');
  assert.equal(ST.formatDuration(5 * 3600 * 1000 + 10 * 60 * 1000), '5 h 10 min');
  assert.equal(ST.formatDuration(3 * GIORNO + 4 * 3600 * 1000), '3 g 4 h');
  assert.equal(ST.formatDuration(null), '—');
});

// ─── Giro 7 di verifica: le porte che i conti devono tenere chiuse ───────────

const TRIM = globalThis.SN_FEEDBACK_THREAD.TRIM_MARK;

// Una conversazione come la scrive il server: `n` critiche, poi il pass. Ogni
// nota è un turno suo, col suo marcatore: è così che Filo le appende.
function verbale(n) {
  let t = 0;
  const turno = () => `--- Aggiornamento dell'agente del 07/09/2026, ${++t} ---`;
  const b = [];
  for (let i = 0; i < n; i += 1) {
    if (i) b.push(turno());
    b.push(
      'Verifica: 1 rilievo.',
      'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
      '- [1] Un rilievo qualunque',
      '',
      turno(),
      'Corretto.',
      '',
    );
  }
  if (n) b.push(turno());
  b.push('Verifica superata.');
  return b.join('\n');
}
const chiuso = (over) => fb(Object.assign({
  status: 'done',
  createdAt: new Date(NOW - 9 * GIORNO).toISOString(),
  _updateTime: new Date(NOW - 2 * GIORNO).toISOString(),
}, over || {}));

test('conversazione tagliata dal tetto: i giri non si contano, e si dice quante sono', () => {
  const intera = ST.compute({ feedbacks: [chiuso({ notes: verbale(5) })], sel: { key: '30d' }, now: NOW });
  assert.equal(intera.giri.media, 5);
  assert.equal(intera.giri.tagliate, 0);

  // La stessa lavorazione nella forma in cui è DAVVERO salvata dopo il taglio:
  // i primi giri non ci sono più. Contare quello che resta la dichiarerebbe
  // «passata subito», cioè il contrario del vero.
  const tagliata = ST.compute({
    feedbacks: [chiuso({ notes: `${TRIM}\n\nVerifica superata.` })],
    sel: { key: '30d' }, now: NOW,
  });
  assert.equal(tagliata.giri.tagliate, 1);
  assert.equal(tagliata.giri.conDati, 0);
  assert.deepEqual(tagliata.giri.fette, []);
  assert.equal(tagliata.giri.media, null);
});

test('le frasi d’esito si leggono solo nella testa del verbale, non dentro i rilievi', () => {
  const corpo = (rilievo) => [
    'Verifica: 1 rilievo.',
    'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
    `- [1] ${rilievo}`,
  ].join('\n');

  const sano = ST.parseRounds(fb({ notes: corpo('Manca l\'hover sull\'icona') }));
  assert.equal(sano[0].kind, 'fix');

  // «il lavoro si ferma» dentro un rilievo è italiano normale, non un verdetto.
  const conFrase = ST.parseRounds(fb({
    notes: corpo('Quando il registro non risponde il lavoro si ferma e la scheda non lo dice'),
  }));
  assert.equal(conFrase[0].kind, 'fix');

  // E la frase vera, che sta dove il server la scrive, continua a valere.
  const stop = ST.parseRounds(fb({
    notes: [
      'Verifica: 1 rilievo.',
      'Il lavoro si ferma: c\'è un rilievo di livello 2 o 3 che non si può correggere da soli.',
      '- [3] I dati dell\'utente finiscono nei log',
    ].join('\n'),
  }));
  assert.equal(stop[0].kind, 'stop');
});

test('«Sempre» comprende le segnalazioni senza data; le altre finestre dicono quante ne lasciano fuori', () => {
  const lista = [
    fb({ _id: 'a' }),
    fb({ _id: 'b', createdAt: null }),
    fb({ _id: 'c', createdAt: 'non-una-data' }),
  ];
  const sempre = ST.compute({ feedbacks: lista, sel: { key: 'all' }, now: NOW });
  assert.equal(sempre.ricevuti.total, 3);
  assert.equal(sempre.ricevuti.senzaData, 2);
  assert.equal(sempre.ricevuti.escluseSenzaData, 0);

  const settimana = ST.compute({ feedbacks: lista, sel: { key: '7d' }, now: NOW });
  assert.equal(settimana.ricevuti.total, 1);
  assert.equal(settimana.ricevuti.escluseSenzaData, 2);
});

test('una finestra molto più larga dei dati non manda in bianco il grafico', () => {
  const lista = [
    fb({ _id: 'a', createdAt: new Date(NOW - GIORNO).toISOString() }),
    fb({ _id: 'b', createdAt: new Date(NOW - 2 * GIORNO).toISOString() }),
  ];
  const dal1900 = ST.timeline(lista, { from: new Date(1900, 0, 1).getTime(), to: NOW, valid: true }, NOW);
  assert.ok(dal1900, 'il grafico deve esserci');
  assert.ok(dal1900.buckets.length <= 66);
  // Le due segnalazioni cadono davvero dentro una colonna disegnata.
  assert.equal(dal1900.buckets.reduce((a, b) => a + b.n, 0), 2);
});

test('una riga d’apertura citata dentro un rilievo non apre un giro', () => {
  const notes = [
    'Verifica: 2 rilievi.',
    'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.',
    '- [2] La scheda non si aggiorna da sola',
    '  Verifica superata. non mi pare: il numero resta fermo.',
    '- [1] Manca l\'hover sull\'icona',
    '  Controllo funzionalità NON superato è la frase vecchia, la cito qui.',
    '',
    '--- Aggiornamento dell\'agente del 08/09/2026, 10:00 ---',
    'Corretto.',
    '',
    '--- Aggiornamento dell\'agente del 08/09/2026, 12:00 ---',
    'Verifica superata.',
  ].join('\n');
  const rounds = ST.parseRounds(fb({ notes }));
  // Un giro con rilievi, non tre.
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].kind, 'fix');
  assert.equal(rounds[0].findings.length, 2);

  const r = ST.loopsBeforePass(fb({ notes }));
  assert.equal(r.passata, true);
  assert.equal(r.giri, 1);
});

// ─── Il conto dei giri non si fida della prosa ───────────────────────────────
//
// Per quattro giri di verifica di fila lo stesso danno è tornato da una porta
// nuova: una frase dentro un rilievo, un commento di una persona, una riga del
// riassunto, il report di chi corregge. Ogni volta il lavoro più combattuto
// finiva nella fetta verde «passata subito». Qui c'è una prova per porta, sul
// verbale COSÌ COME LO SCRIVE IL SERVER (verifierRound.roundNote) e nella
// conversazione così come la scrive Filo (una nota, un turno), perché quello
// che si prova sia quello che succede davvero.

const VR = globalThis.SN_VERIFIER_ROUND;
const TURNO_CORRETTORE = '--- Aggiornamento dell\'agente del 01/09/2026, 10:00 ---';
const TURNO_PASS = '--- Aggiornamento dell\'agente del 01/09/2026, 18:00 ---';

// Un giro di correzione col riassunto che gli si vuole dare, poi la correzione,
// poi il pass. Un giro solo prima del pass, sempre. Tre note, quindi tre turni:
// Filo non scrive mai due note nello stesso turno.
function conversazione(riassunto, coda) {
  const giro = VR.roundNote({
    summary: riassunto,
    findings: [{ level: 1, text: 'Manca l\'hover sull\'icona' }],
    decision: { fix: [{ level: 1 }] },
  });
  return [giro, '', coda || `${TURNO_CORRETTORE}\nCorretto.`, '', TURNO_PASS, 'Verifica superata.'].join('\n');
}

function esito(notes) {
  const rounds = ST.parseRounds(fb({ notes }));
  const loops = ST.loopsBeforePass(fb({ notes }));
  return {
    kinds: rounds.map((r) => r.kind),
    giri: loops && loops.giri,
    passata: loops && loops.passata,
  };
}
const UN_GIRO = { kinds: ['fix'], giri: 1, passata: true };

test('il conto dei giri non cambia per una riga del RIASSUNTO che sembra un verbale', () => {
  const pulito = esito(conversazione('Provato: tutto quanto. Funziona.'));
  assert.deepEqual(pulito, UN_GIRO);

  for (const riga of [
    // Il verificatore riassume il giro prima: sono frasi normali.
    'Verifica: 2 rilievi del giro scorso sono chiusi.',
    'Verifica superata. Le porte del giro scorso sono chiuse.',
    'Controllo funzionalità NON superato nel giro scorso, adesso sì.',
  ]) {
    // Attaccata al riassunto e in un paragrafo suo: due modi di scriverla.
    assert.deepEqual(esito(conversazione(`Provato: tutto quanto.\n${riga}`)), pulito, riga);
    assert.deepEqual(esito(conversazione(`Provato: tutto quanto.\n\n${riga}`)), pulito, riga);
  }
});

test('la frase d’esito si legge dalla riga che il server scrive, non dal riassunto', () => {
  // «Il lavoro si ferma quando…» è italiano normale dentro un riassunto, e
  // trasformava un giro di correzione in un giro bloccante.
  const notes = conversazione(
    'Provato: tutto quanto.\nIl lavoro si ferma quando il registro non risponde, e la scheda non lo dice.',
  );
  const rounds = ST.parseRounds(fb({ notes }));
  assert.equal(rounds[0].kind, 'fix');
  assert.equal(rounds.filter((r) => r.kind === 'stop').length, 0);
});

test('quello che scrive una PERSONA nella conversazione non è mai un giro di verifica', () => {
  const commento = [
    '--- La tua risposta del 02/09/2026, 09:00 ---',
    'Verifica superata. secondo me no, guarda meglio.',
  ].join('\n');
  const notes = conversazione('Provato: tutto quanto.', `${commento}\n\n${TURNO_CORRETTORE}\nCorretto.`);
  assert.deepEqual(esito(notes), UN_GIRO);
});

test('il report di chi corregge non conta come un giro passato', () => {
  for (const corpo of [
    'Ho rilanciato le prove del giro.\nVerifica superata. Nessuna regressione.',
    'Ho rilanciato le prove del giro.\n\nVerifica superata. Nessuna regressione.',
    // Chi corregge cita la frase vecchia raccontando il giro prima: prima
    // inventava un giro bloccante che il server non aveva mai registrato.
    'Ho corretto.\n\nControllo funzionalità NON superato era il verdetto del giro scorso.',
    'Ho corretto.\n\nVerifica: 3 rilievi.',
  ]) {
    const notes = conversazione('Provato: tutto quanto.', `${TURNO_CORRETTORE}\n${corpo}`);
    assert.deepEqual(esito(notes), UN_GIRO, corpo);
  }
});

test('il riassunto di un verbale SUPERATO non apre un secondo giro', () => {
  // Un pass è una nota sola: apertura e riassunto sullo stesso capoverso, e
  // tutto il resto è ancora riassunto. Una riga più giù che comincia come un
  // verbale faceva uscire la lavorazione dalla torta e la dichiarava ferma.
  const pass = (riassunto) => [
    VR.roundNote({
      summary: 'Provato: tutto quanto.',
      findings: [{ level: 1, text: 'Manca l\'hover sull\'icona' }],
      decision: { fix: [{ level: 1 }] },
    }),
    '',
    `${TURNO_CORRETTORE}\nCorretto.`,
    '',
    TURNO_PASS,
    `Verifica superata. ${riassunto}`,
  ].join('\n');

  const pulito = esito(pass('Provato tutto: adesso funziona.'));
  assert.deepEqual(pulito, UN_GIRO);

  for (const riga of [
    'Controllo funzionalità NON superato nel giro scorso, adesso sì.',
    'Verifica: funziona, ma migliorabile — così diceva il giro scorso.',
    'Verifica: 2 rilievi del giro scorso sono chiusi.',
    'Il lavoro si ferma quando il registro non risponde: adesso non più.',
  ]) {
    assert.deepEqual(esito(pass(`Provato tutto.\n\n${riga}`)), pulito, riga);
  }
});

// ─── La quinta porta della stessa famiglia: la PRIMA riga di un turno ────────
//
// Il giro 9 aveva stretto la ricerca alla prima riga scritta di ogni turno di
// Filo. Ma la prima riga di un turno la scrive anche chi non sta verbalizzando
// niente: chi corregge apre il report con la conferma in una riga, chi risponde
// incolla un pezzo di conversazione col suo marcatore dentro, l'owner scrive
// una nota in cima al campo note. Quattro strade, una causa: si cercavano
// parole. Adesso i numeri vengono dai verbali che esibiscono la loro struttura,
// e la riga «superata» dice soltanto sì o no.

// Due correzioni prima del pass, come le scrive Filo: una nota, un turno.
function dueCorrezioni(reportCorrettore) {
  const giro = () => VR.roundNote({
    summary: 'Provato: tutto quanto.',
    findings: [{ level: 1, text: 'Manca l\'hover sull\'icona' }],
    decision: { fix: [{ level: 1 }] },
  });
  return [
    giro(),
    '',
    `${TURNO_CORRETTORE}\n${reportCorrettore}`,
    '',
    `--- Aggiornamento dell'agente del 02/09/2026, 10:00 ---\n${giro()}`,
    '',
    `--- Aggiornamento dell'agente del 02/09/2026, 14:00 ---\n${reportCorrettore}`,
    '',
    `${TURNO_PASS}\nVerifica superata. Provato tutto: adesso funziona.`,
  ].join('\n');
}
const DUE_GIRI_ATTESI = { kinds: ['fix', 'fix'], giri: 2, passata: true };

test('la conferma in cima al report di chi corregge non toglie un giro', () => {
  assert.deepEqual(esito(dueCorrezioni('Corretto. Ho rilanciato le prove del giro.')), DUE_GIRI_ATTESI);
  // È la forma che il repo chiede a un report di consegna: conferma in una riga.
  for (const report of [
    'Verifica superata. Nessuna regressione: ho rilanciato le prove del giro.',
    'Controllo funzionalità NON superato era il verdetto del giro scorso: adesso è chiuso.',
    'Verifica: funziona, ma migliorabile, così diceva il giro scorso.',
    'Verifica: 2 rilievi del giro scorso sono chiusi.',
  ]) {
    assert.deepEqual(esito(dueCorrezioni(report)), DUE_GIRI_ATTESI, report);
  }
});

test('un pezzo di conversazione incollato in una risposta non diventa un turno di Filo', () => {
  const citazione = [
    '--- La tua risposta del 02/09/2026, 09:00 ---',
    'Riporto quello che avevo letto:',
    '--- Aggiornamento dell\'agente del 01/09/2026, 10:00 ---',
    'Verifica superata. secondo me non è così.',
  ].join('\n');
  const notes = dueCorrezioni('Corretto.').replace(
    `${TURNO_CORRETTORE}\nCorretto.`,
    `${TURNO_CORRETTORE}\nCorretto.\n\n${citazione}`,
  );
  assert.deepEqual(esito(notes), DUE_GIRI_ATTESI);
});

test('una nota scritta in cima al campo note non diventa un giro di verifica', () => {
  // Il campo note della dashboard si modifica per intero in una casella di
  // testo, e quello che sta prima del primo marcatore è, per il parser, un
  // turno di Filo.
  const notes = `Verifica superata. Ho guardato io, va bene.\n\n${dueCorrezioni('Corretto.')}`;
  assert.deepEqual(esito(notes), DUE_GIRI_ATTESI);
});

// ─── Chi ha mandato la segnalazione, quando non si legge ────────────────────

test('compute: un mittente cifrato non finisce sotto «Utente», si dichiara', () => {
  const lista = [
    fb({ _id: 'a', clientId: 'FENC1:aaaa' }),
    fb({ _id: 'b', clientId: 'FENC1:bbbb' }),
    fb({ _id: 'c', clientId: 'routine:prober' }),
  ];
  const r = ST.compute({ feedbacks: lista, sel: { key: '7d' }, now: NOW });
  const per = Object.fromEntries(r.creatori.map((c) => [c.key, c.n]));
  assert.equal(per.user, 0, 'il ciphertext non è un utente: è un mittente che non si legge');
  assert.equal(per.prober, 1);
  assert.equal(r.mittentiIllegibili, 2);
  // E il filtro per creatore non se li porta dietro sotto una categoria a caso.
  const soloProber = ST.compute({ feedbacks: lista, sel: { key: '7d' }, creators: ['prober'], now: NOW });
  assert.equal(soloProber.ricevuti.total, 1);
  const soloUtenti = ST.compute({ feedbacks: lista, sel: { key: '7d' }, creators: ['user'], now: NOW });
  assert.equal(soloUtenti.ricevuti.total, 0);
});

// ─── Gli arrivi nel futuro ──────────────────────────────────────────────────

test('compute: una data d\'arrivo nel futuro entra nel totale e si dichiara', () => {
  const lista = [
    fb({ _id: 'a', createdAt: new Date(NOW - GIORNO).toISOString() }),
    fb({ _id: 'b', createdAt: new Date(NOW + 30 * GIORNO).toISOString() }),
  ];
  const r = ST.compute({ feedbacks: lista, sel: { key: 'all' }, now: NOW });
  assert.equal(r.ricevuti.total, 2);
  assert.equal(r.ricevuti.nelFuturo, 1);
  // Il grafico finisce a oggi: la somma delle colonne è più piccola, e la
  // pagina lo scrive invece di lasciare due numeri diversi senza spiegazione.
  const dentro = r.ricevuti.timeline.buckets.reduce((a, b) => a + b.n, 0);
  assert.equal(dentro, 1);
});
