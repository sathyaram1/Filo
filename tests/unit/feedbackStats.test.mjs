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

test('parseRounds: legge il verbale di oggi, un giro per volta', () => {
  const rounds = ST.parseRounds({ notes: NOTE_DUE_GIRI });
  assert.equal(rounds.length, 2);
  assert.equal(rounds[0].kind, 'fix');
  assert.equal(rounds[0].findings.length, 2);
  assert.equal(rounds[1].kind, 'pass');
});

test('parseRounds: distingue "il lavoro si ferma" da "i rilievi vanno in un feedback derivato"', () => {
  assert.equal(ST.parseRounds({ notes: NOTE_BLOCCANTE })[0].kind, 'stop');
  assert.equal(ST.parseRounds({ notes: NOTE_RIMANDATI })[0].kind, 'rimandati');
});

test('parseRounds: capisce anche i verbali vecchi (pass / fail / migliorabile)', () => {
  assert.equal(ST.parseRounds({ notes: 'Controllo funzionalità superato.' })[0].kind, 'pass');
  assert.equal(ST.parseRounds({ notes: 'Controllo funzionalità NON superato: non compare.' })[0].kind, 'stop');
  assert.equal(ST.parseRounds({ notes: 'Verifica: funziona, ma migliorabile — manca l\'hover.' })[0].kind, 'rimandati');
});

test('parseRounds: un livello scritto nel report di chi ha lavorato non diventa un rilievo della verifica', () => {
  const notes = [
    'Verifica superata.',
    '',
    '--- Aggiornamento dell\'agente del 07/09/2026, 10:00 ---',
    '- [2] questo è un elenco del report, non un rilievo',
  ].join('\n');
  const rounds = ST.parseRounds({ notes });
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].findings.length, 0);
});

test('parseRounds: note assenti o cifrate → nessun giro (non uno zero inventato)', () => {
  assert.deepEqual(ST.parseRounds({ notes: '' }), []);
  assert.deepEqual(ST.parseRounds({}), []);
  assert.deepEqual(ST.parseRounds({ notes: 'FENC1:abcdef' }), []);
});

test('loopsBeforePass: i giri sono quelli PRIMA del primo esito che fa proseguire', () => {
  assert.deepEqual(pick(ST.loopsBeforePass({ notes: NOTE_PASS_SUBITO })), { passata: true, giri: 0 });
  assert.deepEqual(pick(ST.loopsBeforePass({ notes: NOTE_DUE_GIRI })), { passata: true, giri: 1 });
  assert.deepEqual(pick(ST.loopsBeforePass({ notes: NOTE_RIMANDATI })), { passata: true, giri: 0 });
  assert.deepEqual(pick(ST.loopsBeforePass({ notes: NOTE_BLOCCANTE })), { passata: false, giri: 1 });
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
    'Verifica superata.',
  ].join('\n');
  const rounds = ST.parseRounds(fb({ notes }));
  // Due giri: quello con i due rilievi, e il pass. Non quattro.
  assert.equal(rounds.length, 2);
  assert.equal(rounds[0].kind, 'fix');
  assert.equal(rounds[0].findings.length, 2);
  assert.equal(rounds[1].kind, 'pass');

  const r = ST.loopsBeforePass(fb({ notes }));
  assert.equal(r.passata, true);
  assert.equal(r.giri, 1);
});

// ─── Il conto dei giri non si fida della prosa ───────────────────────────────
//
// Per tre giri di verifica di fila lo stesso danno è tornato da una porta
// nuova: una frase dentro un rilievo, un commento di una persona, una riga del
// riassunto. Ogni volta il lavoro più combattuto finiva nella fetta verde
// «passata subito». Qui c'è una prova per porta, sul verbale COSÌ COME LO
// SCRIVE IL SERVER (verifierRound.roundNote), perché quello che si prova sia
// quello che succede davvero.

const VR = globalThis.SN_VERIFIER_ROUND;
const TURNO_CORRETTORE = '--- Aggiornamento dell\'agente del 01/09/2026, 10:00 ---';

// Un giro di correzione col riassunto che gli si vuole dare, poi la correzione,
// poi il pass. Un giro solo prima del pass, sempre.
function conversazione(riassunto, coda) {
  const giro = VR.roundNote({
    summary: riassunto,
    findings: [{ level: 1, text: 'Manca l\'hover sull\'icona' }],
    decision: { fix: [{ level: 1 }] },
  });
  return [giro, '', coda || `${TURNO_CORRETTORE}\nCorretto.`, '', 'Verifica superata.'].join('\n');
}

function esito(notes) {
  const rounds = ST.parseRounds(fb({ notes }));
  const loops = ST.loopsBeforePass(fb({ notes }));
  return { kinds: rounds.map((r) => r.kind), giri: loops && loops.giri };
}

test('il conto dei giri non cambia per una riga del RIASSUNTO che sembra un verbale', () => {
  const pulito = esito(conversazione('Provato: tutto quanto. Funziona.'));
  assert.deepEqual(pulito, { kinds: ['fix', 'pass'], giri: 1 });

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
  assert.deepEqual(esito(notes), { kinds: ['fix', 'pass'], giri: 1 });
});

test('il report di chi corregge non conta come un giro passato', () => {
  for (const corpo of [
    'Ho rilanciato le prove del giro.\nVerifica superata. Nessuna regressione.',
    'Ho rilanciato le prove del giro.\n\nVerifica superata. Nessuna regressione.',
  ]) {
    const notes = conversazione('Provato: tutto quanto.', `${TURNO_CORRETTORE}\n${corpo}`);
    assert.deepEqual(esito(notes), { kinds: ['fix', 'pass'], giri: 1 }, corpo);
  }
});
