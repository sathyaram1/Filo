// Il riordino della numerazione: quanto costa scoprire che non c'è niente da fare.
//
// Il comando scaricava la collezione intera, documenti interi, per accorgersi
// che tutte le segnalazioni hanno già un numero. Lanciato tre volte in un
// pomeriggio (prova a secco, applicazione, controllo) è il candidato del giorno
// che ha fatto il 40% del conto mensile di Firestore (#680).
//
// Qui si guarda la RICHIESTA che parte, non solo il risultato: due conteggi
// prima della scansione, e la scansione — quando serve — che chiede i soli
// campi che usa. Senza il fix questo file è rosso. In fondo, il contatore che
// un numero anonimo non deve spostare (#923).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const { backfillNumbers, CAMPI_NUMERAZIONE } = await import('../../scripts/backfill-feedback-numbers.mjs');

// Un Firestore finto che risponde ai tre tipi di domanda e registra tutto.
// `senzaContatore`: il contatore non esiste finché qualcuno non lo scrive.
function firestoreFinto({ totale, numerati, documenti = [], contaRotta = false, contatore = null, senzaContatore = false }) {
  const chiamate = { conteggi: [], scansioni: [], maxSeq: 0, patch: [], numeri: [], contatore: 0, contatoreScritto: [] };
  // Il contatore vero è almeno il numero più alto dato da un invio.
  let manca = senzaContatore;
  let valore = contatore != null ? contatore
    : documenti.length ? Math.max(0, ...documenti.map((d) => Number(d.fields.seq?.integerValue || 0))) : totale;
  const fatto = async (url, opts) => {
    const corpo = opts && opts.body ? JSON.parse(opts.body) : {};
    if (String(url).includes(':runAggregationQuery')) {
      if (contaRotta) return { ok: false, status: 400, text: async () => 'MISSING_INDEX' };
      const filtro = corpo.structuredAggregationQuery.structuredQuery.where;
      chiamate.conteggi.push(filtro ? 'numerati' : 'totale');
      const n = filtro ? numerati : totale;
      return { ok: true, status: 200, json: async () => ([{ result: { aggregateFields: { quanti: { integerValue: String(n) } } } }]) };
    }
    if (String(url).includes(':runQuery')) {
      const q = corpo.structuredQuery;
      // La domanda «il numero più alto» ordina per seq e ne chiede uno solo.
      if (q.limit === 1 && q.orderBy && q.orderBy[0].field.fieldPath === 'seq') {
        chiamate.maxSeq += 1;
        return { ok: true, status: 200, json: async () => ([{ document: { name: 'p/feedback/z', fields: { seq: { integerValue: String(totale) } } } }]) };
      }
      chiamate.scansioni.push(q);
      return { ok: true, status: 200, json: async () => documenti.map((d) => ({ document: d })) };
    }
    if (String(url).includes('/counters/')) {
      chiamate.contatore += 1;
      if (opts && opts.method === 'PATCH') {
        valore = Number(corpo.fields.value.integerValue);
        manca = false;
        chiamate.contatoreScritto.push(valore);
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (manca) return { ok: false, status: 404, json: async () => ({}), text: async () => 'NOT_FOUND' };
      return { ok: true, status: 200, json: async () => ({ fields: { value: { integerValue: String(valore) } }, updateTime: 'T1' }) };
    }
    chiamate.patch.push(String(url));
    if (corpo.fields && corpo.fields.seq) chiamate.numeri.push(Number(corpo.fields.seq.integerValue));
    return { ok: true, status: 200, text: async () => '' };
  };
  return { fatto, chiamate };
}

function conFetch(finto, corpo) {
  const vera = globalThis.fetch;
  globalThis.fetch = finto.fatto;
  const dette = [];
  const log = console.log; const warn = console.warn;
  console.log = (...a) => dette.push(a.join(' '));
  console.warn = (...a) => dette.push(a.join(' '));
  return corpo().finally(() => {
    globalThis.fetch = vera;
    console.log = log; console.warn = warn;
  }).then((r) => ({ r, dette: dette.join('\n') }));
}

const doc = (id, seq, iso, senderProof = '') => ({
  name: `p/databases/(default)/documents/feedback/${id}`,
  fields: {
    createdAt: { timestampValue: iso },
    ...(seq ? { seq: { integerValue: String(seq) } } : {}),
    ...(senderProof ? { senderProof: { stringValue: senderProof } } : {}),
    name: { stringValue: `titolo ${id}` },
  },
});

test('tutte già numerate: due conteggi e una domanda sul contatore — la collezione non si legge', async () => {
  const finto = firestoreFinto({ totale: 763, numerati: 763 });
  const { r, dette } = await conFetch(finto, () => backfillNumbers('tok', { dry: true, copiaDir: cartellaTemporanea('backfill-1-') }));
  assert.deepEqual(finto.chiamate.scansioni, [],
    'senza il fix qui partivano fino a 40 pagine da 500 documenti interi per non fare niente');
  assert.deepEqual(finto.chiamate.conteggi.sort(), ['numerati', 'totale']);
  assert.equal(finto.chiamate.contatore, 1);
  assert.equal(finto.chiamate.maxSeq, 0, 'il massimo di tutti conta anche i numeri scelti da chi manda (#923)');
  assert.equal(r.numbered, 0);
  assert.match(dette, /763 feedback totali: 763 già numerati, 0 da numerare \(si parte da #764\)/,
    'la riga che si stampa deve restare quella di prima');
  assert.match(dette, /Documenti letti dal server in questo giro: 3/,
    'chi lancia il comando vede il costo sullo schermo, non in fattura');
});

test('quando c\'è da numerare, la scansione chiede i soli campi che usa', async () => {
  const documenti = [doc('a', 1, '2026-01-01T00:00:00Z'), doc('b', 0, '2026-01-02T00:00:00Z')];
  const finto = firestoreFinto({ totale: 2, numerati: 1, documenti });
  const { r, dette } = await conFetch(finto, () => backfillNumbers('tok', { dry: true, copiaDir: cartellaTemporanea('backfill-2-') }));
  assert.equal(finto.chiamate.scansioni.length >= 1, true, 'con una segnalazione senza numero la scansione ci vuole');
  const campi = finto.chiamate.scansioni[0].select.fields.map((f) => f.fieldPath);
  assert.deepEqual(campi, CAMPI_NUMERAZIONE,
    'senza select arrivava il documento intero: testo cifrato, note e allegati per guardarne quattro campi');
  assert.ok(!campi.includes('text'), 'il testo della segnalazione è il grosso dei suoi KB e qui non serve');
  assert.equal(r.numbered, 1);
  assert.match(dette, /2 feedback totali: 1 già numerati, 1 da numerare \(si parte da #2\)/);
  assert.match(dette, /#2 → b/);
  assert.match(dette, /Documenti letti dal server in questo giro: 5/, 'due conteggi, due segnalazioni e il contatore');
});

test('un server che non sa contare non ferma il comando: scansiona e lo dichiara', async () => {
  const documenti = [doc('a', 1, '2026-01-01T00:00:00Z')];
  const finto = firestoreFinto({ totale: 1, numerati: 1, documenti, contaRotta: true });
  const { dette } = await conFetch(finto, () => backfillNumbers('tok', { dry: true, copiaDir: cartellaTemporanea('backfill-3-') }));
  assert.equal(finto.chiamate.scansioni.length, 1, 'senza conteggio si torna alla scansione');
  assert.match(dette, /il server non ha saputo contare/,
    'un ripiego silenzioso nasconde un costo: chi lancia il comando deve saperlo');
});

test('la prova a secco non scrive niente, e l\'applicazione riusa la sua lettura', async () => {
  const dir = cartellaTemporanea('backfill-4-');
  const documenti = [doc('a', 1, '2026-01-01T00:00:00Z'), doc('b', 0, '2026-01-02T00:00:00Z')];
  const t0 = 1_700_000_000_000;

  const secco = firestoreFinto({ totale: 2, numerati: 1, documenti });
  await conFetch(secco, () => backfillNumbers('tok', { dry: true, now: t0, copiaDir: dir }));
  assert.deepEqual(secco.chiamate.patch, [], 'una prova a secco non scrive');

  const applica = firestoreFinto({ totale: 2, numerati: 1, documenti });
  const { dette } = await conFetch(applica, () => backfillNumbers('tok', { dry: false, now: t0 + 30_000, copiaDir: dir }));
  assert.deepEqual(applica.chiamate.scansioni, [], 'l\'applicazione ha ripagato la scansione della prova a secco');
  assert.match(dette, /Riuso la lettura della prova a secco/);
  assert.equal(applica.chiamate.patch.length, 1, 'il numero va scritto comunque');

  // Applicato: la copia non descrive più il server, e il giro dopo rilegge.
  const dopo = firestoreFinto({ totale: 2, numerati: 1, documenti });
  await conFetch(dopo, () => backfillNumbers('tok', { dry: false, now: t0 + 40_000, copiaDir: dir }));
  assert.equal(dopo.chiamate.scansioni.length, 1);
});

test('se dalla prova a secco le segnalazioni sono cambiate, la lettura si rifà invece di dare numeri già presi', async () => {
  // I numeri si assegnano contando quelli che ci sono. Una segnalazione
  // arrivata dopo la prova a secco il numero se lo prende da sé, ed è il primo
  // che questo giro sta per dare: senza rilettura due segnalazioni finiscono
  // con lo stesso numero, e un numero doppio non si aggiusta da sé.
  const dir = cartellaTemporanea('backfill-5-');
  const prima = [doc('a', 1, '2026-01-01T00:00:00Z'), doc('b', 0, '2026-01-02T00:00:00Z')];
  const t0 = 1_700_000_000_000;

  const secco = firestoreFinto({ totale: 2, numerati: 1, documenti: prima });
  await conFetch(secco, () => backfillNumbers('tok', { dry: true, now: t0, copiaDir: dir }));

  // Nel frattempo ne arriva una, che si prende il #2.
  const dopo = [...prima, doc('c', 2, '2026-01-03T00:00:00Z')];
  const applica = firestoreFinto({ totale: 3, numerati: 2, documenti: dopo });
  const { r, dette } = await conFetch(applica, () => backfillNumbers('tok', { dry: false, now: t0 + 30_000, copiaDir: dir }));
  assert.equal(applica.chiamate.scansioni.length, 1, 'ha tenuto l\'elenco vecchio e assegnerebbe un numero già preso');
  assert.equal(r.total, 3, 'ha deciso su due segnalazioni mentre sul server ne sono tre');
  assert.match(dette, /sono cambiate/, 'una rilettura silenziosa non dice a chi lancia perché sta ripagando');
});

test('se invece non è cambiato niente la lettura resta una: la guardia non ripaga per abitudine', async () => {
  const dir = cartellaTemporanea('backfill-6-');
  const documenti = [doc('a', 1, '2026-01-01T00:00:00Z'), doc('b', 0, '2026-01-02T00:00:00Z')];
  const t0 = 1_700_000_000_000;
  const secco = firestoreFinto({ totale: 2, numerati: 1, documenti });
  await conFetch(secco, () => backfillNumbers('tok', { dry: true, now: t0, copiaDir: dir }));
  const applica = firestoreFinto({ totale: 2, numerati: 1, documenti });
  const { dette } = await conFetch(applica, () => backfillNumbers('tok', { dry: false, now: t0 + 30_000, copiaDir: dir }));
  assert.deepEqual(applica.chiamate.scansioni, []);
  assert.doesNotMatch(dette, /sono cambiate/);
});

// #923: un create anonimo sceglie il proprio numero, fino a un milione. Contarlo
// voleva dire numerare da 1.000.001 e portare lassù il contatore, oltre il tetto
// delle regole: da lì nessun feedback dell'app avrebbe più avuto un numero.
test('un numero anonimo enorme non sposta la numerazione né il contatore', async () => {
  const documenti = [
    doc('a', 1, '2026-01-01T00:00:00Z', 'admin'),
    doc('d', 2, '2026-01-02T00:00:00Z'),
    doc('b', 0, '2026-01-03T00:00:00Z'),
    doc('falso', 1000000, '2026-01-04T00:00:00Z'),
  ];
  const finto = firestoreFinto({ totale: 4, numerati: 3, documenti, contatore: 2 });
  const { r } = await conFetch(finto, () => backfillNumbers('tok', { dry: false, usaCopia: false, copiaDir: cartellaTemporanea('backfill-7-') }));
  assert.equal(r.numbered, 1);
  assert.deepEqual(finto.chiamate.numeri, [3], 'il numero nuovo viene dopo il contatore, non dopo il numero scelto da chi manda');
  assert.deepEqual(finto.chiamate.contatoreScritto, [3]);
});

test('un numero con la prova del mittente oltre il contatore lo alza', async () => {
  const documenti = [
    doc('a', 40, '2026-01-01T00:00:00Z', 'server'),
    doc('b', 0, '2026-01-02T00:00:00Z'),
  ];
  const finto = firestoreFinto({ totale: 2, numerati: 1, documenti, contatore: 30 });
  await conFetch(finto, () => backfillNumbers('tok', { dry: false, usaCopia: false, copiaDir: cartellaTemporanea('backfill-8-') }));
  assert.deepEqual(finto.chiamate.numeri, [41]);
  assert.deepEqual(finto.chiamate.contatoreScritto, [41]);
});

// Senza contatore il punto di partenza non è il solo numero provato: i feedback senza prova hanno numeri dati
// dal contatore di prima, e ripartire sotto di loro li ridarebbe.
test('col contatore che manca si numera oltre ogni numero in uso, e il contatore rinasce lì', async () => {
  const documenti = [
    doc('a', 10, '2026-01-01T00:00:00Z', 'admin'),
    doc('d', 25, '2026-01-02T00:00:00Z'),
    doc('b', 0, '2026-01-03T00:00:00Z'),
  ];
  const finto = firestoreFinto({ totale: 3, numerati: 2, documenti, senzaContatore: true });
  await conFetch(finto, () => backfillNumbers('tok', { dry: false, usaCopia: false, copiaDir: cartellaTemporanea('backfill-9-') }));
  assert.deepEqual(finto.chiamate.numeri, [26]);
  assert.deepEqual(finto.chiamate.contatoreScritto, [26]);
});

test('tutte numerate ma il contatore manca: rinasce sul numero più alto in uso', async () => {
  const finto = firestoreFinto({ totale: 25, numerati: 25, senzaContatore: true });
  const { dette } = await conFetch(finto, () => backfillNumbers('tok', { dry: false, usaCopia: false, copiaDir: cartellaTemporanea('backfill-10-') }));
  assert.deepEqual(finto.chiamate.contatoreScritto, [25]);
  assert.match(dette, /si parte da #26/);
});
