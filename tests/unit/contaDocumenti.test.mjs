// Il conteggio dei documenti per il trasloco del database (#1763): ogni raccolta, sottoraccolte comprese, solo letture,
// un elenco uguale a ogni giro e il confronto prima/dopo. Firestore è un server finto che risponde come quello vero.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import { conFreno } from '../../scripts/lib/freno-letture.mjs';
import {
  leggiArgomenti, comandoToken, tokenDaGcloud, soloLettura, clienteFirestore, contaRaccolte, raccoltaDi, gruppoDi,
  perGruppo, righeElenco, confronta, righeConfronto, leggiConteggio, ultimoSalvato, nomeFile, cartellaConteggi, main,
  FIRESTORE_V1, FORMATO, PROGETTO_FILO,
} from '../../scripts/conta-documenti.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROGETTO = 'filo-prova';
const RADICE = `projects/${PROGETTO}/databases/(default)/documents`;

const DOCUMENTI = [
  'feedback/a', 'feedback/b', 'feedback/ABC',
  'feedback/a/note/1', 'feedback/a/note/2', 'feedback/b/note/1',
  'feedback/c/note/1', // «c» non esiste: la sua sottoraccolta sì
  'feedback/a/note/1/risposte/x',
  'feedback-public/a',
  'config/models', 'config/secrets',
  'paths/x.com/entries/1', 'paths/x.com/entries/2', 'paths/y.com/entries/1',
  'Zeta/uno con spazi 🎉',
];
const ATTESO = {
  Zeta: 1,
  config: 2,
  feedback: 3,
  'feedback-public': 1,
  'feedback/a/note': 2,
  'feedback/a/note/1/risposte': 1,
  'feedback/b/note': 1,
  'feedback/c/note': 1,
  'paths/x.com/entries': 2,
  'paths/y.com/entries': 1,
};

// L'ordine dei nomi di Firestore: per segmenti, e gli id numerici (__id<n>__) prima di ogni stringa.
const NUMERICO = /^__id(-?\d+)__$/;
function perSegmento(a, b) {
  const na = a.match(NUMERICO);
  const nb = b.match(NUMERICO);
  if (Boolean(na) !== Boolean(nb)) return na ? -1 : 1;
  if (na) { const x = BigInt(na[1]); const y = BigInt(nb[1]); return x < y ? -1 : x > y ? 1 : 0; }
  return a < b ? -1 : a > b ? 1 : 0;
}
function perNomeFirestore(a, b) {
  const x = a.split('/');
  const y = b.split('/');
  for (let i = 0; i < Math.min(x.length, y.length); i++) { const c = perSegmento(x[i], y[i]); if (c) return c; }
  return x.length - y.length;
}

function risposta(status, corpo) {
  const testo = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
  return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(testo), text: async () => testo };
}

function serverFinto(relativi = DOCUMENTI, { elencoPerPagina = 2, guasti = [] } = {}) {
  const docs = relativi.map((n) => `${RADICE}/${n}`).sort(perNomeFirestore);
  const richieste = [];
  const fetchImpl = async (url, init = {}) => {
    const corpo = JSON.parse(init.body || '{}');
    richieste.push({ url: String(url), metodo: init.method, corpo, headers: init.headers || {} });
    const guasto = guasti.shift();
    if (guasto) return risposta(guasto.status, guasto.corpo || { error: { status: 'X', message: `finto ${guasto.status}` } });
    const percorso = decodeURIComponent(new URL(url).pathname);
    if (percorso === `/v1/${RADICE}:listCollectionIds`) {
      const ids = [...new Set(docs.map((d) => d.slice(RADICE.length + 1).split('/')[0]))].sort();
      const da = Number(corpo.pageToken || 0);
      const n = Math.min(Number(corpo.pageSize) || 1, elencoPerPagina);
      return risposta(200, Object.assign({ collectionIds: ids.slice(da, da + n) }, da + n < ids.length ? { nextPageToken: String(da + n) } : {}));
    }
    if (percorso === `/v1/${RADICE}:runQuery`) {
      const sq = corpo.structuredQuery;
      assert.deepEqual(sq.from, [{ allDescendants: true }], 'la domanda deve prendere tutti i discendenti');
      assert.deepEqual(sq.select, { fields: [{ fieldPath: '__name__' }] }, 'solo i nomi');
      assert.deepEqual(sq.orderBy, [{ field: { fieldPath: '__name__' } }]);
      const [da, a] = sq.where.compositeFilter.filters.map((f) => f.fieldFilter);
      assert.equal(da.op, 'GREATER_THAN_OR_EQUAL');
      assert.equal(a.op, 'LESS_THAN');
      let ris = docs.filter((d) => perNomeFirestore(d, da.value.referenceValue) >= 0 && perNomeFirestore(d, a.value.referenceValue) < 0);
      if (sq.startAt) {
        const c = sq.startAt.values[0].referenceValue;
        ris = ris.filter((d) => (sq.startAt.before ? perNomeFirestore(d, c) >= 0 : perNomeFirestore(d, c) > 0));
      }
      ris = ris.slice(0, sq.limit);
      return risposta(200, ris.length ? ris.map((name) => ({ document: { name, createTime: 't', updateTime: 't' }, readTime: 't' })) : [{ readTime: 't' }]);
    }
    return risposta(404, { error: { status: 'NOT_FOUND', message: `non c'è: ${percorso}` } });
  };
  return { fetchImpl, richieste };
}

const senzaAttese = async () => {};
const tokenFinto = () => {
  const chiamate = [];
  return { chiamate, token: async (o) => { chiamate.push(o); return `tok${chiamate.length}`; } };
};

test('conta ogni raccolta, sottoraccolte comprese, anche sotto un documento che non esiste', async () => {
  const s = serverFinto();
  const t = tokenFinto();
  const cliente = clienteFirestore({ progetto: PROGETTO, token: t.token, fetchImpl: conFreno(s.fetchImpl), attendi: senzaAttese });
  const avanzamenti = [];
  const conto = await contaRaccolte(cliente, { quanti: 2, avanzamento: (a) => avanzamenti.push(a) });
  assert.deepEqual(conto.raccolte, ATTESO);
  assert.deepEqual(Object.keys(conto.raccolte), Object.keys(ATTESO), 'stesso ordine a ogni giro');
  assert.equal(conto.totale, DOCUMENTI.length);
  assert.deepEqual(avanzamenti.filter((a) => a.finita).map((a) => [a.id, a.visti]),
    [['Zeta', 1], ['config', 2], ['feedback', 8], ['feedback-public', 1], ['paths', 3]]);
  assert.equal(t.chiamate.length, 1, 'un token per tutto il giro');
  for (const r of s.richieste) {
    assert.equal(r.metodo, 'POST');
    assert.equal(r.headers.Authorization, 'Bearer tok1');
    assert.equal(r.headers['x-goog-user-project'], PROGETTO);
  }
  assert.ok(cliente.letture.totale >= DOCUMENTI.length, 'il conto delle letture comprende ogni documento');
  assert.match(cliente.letture.riga(), /Documenti letti dal server in questo giro: \d+/);
});

test('legge e basta: ogni altra richiesta si ferma prima della rete', async () => {
  const base = `${FIRESTORE_V1}/${RADICE}`;
  soloLettura(`${base}:runQuery`, { method: 'POST' });
  soloLettura(`${base}:listCollectionIds`, { method: 'POST' });
  soloLettura(`${base}/feedback/a:listCollectionIds`, { method: 'POST' });
  for (const [url, method] of [
    [`${base}:commit`, 'POST'], [`${base}:batchWrite`, 'POST'], [`${base}/feedback/a`, 'PATCH'],
    [`${base}/feedback/a`, 'DELETE'], [`${base}/feedback`, 'GET'], [`${base}:runQuery`, 'GET'],
    [`${FIRESTORE_V1}/projects/${PROGETTO}/databases/(default):exportDocuments`, 'POST'],
  ]) {
    assert.throws(() => soloLettura(url, { method }), /legge e basta/, `${method} ${url}`);
  }
  const s = serverFinto();
  await contaRaccolte(clienteFirestore({ progetto: PROGETTO, token: async () => 't', fetchImpl: s.fetchImpl }), { quanti: 3 });
  const viste = new Set(s.richieste.map((r) => `${r.metodo} ${new URL(r.url).pathname.split(':').pop()}`));
  assert.deepEqual([...viste].sort(), ['POST listCollectionIds', 'POST runQuery']);
});

test('ritenta quando Firestore è occupato, rinnova il token scaduto, e un no si ferma dicendo perché', async () => {
  const s = serverFinto(DOCUMENTI, { guasti: [{ status: 503 }, { status: 429 }, { status: 401 }] });
  const t = tokenFinto();
  const attese = [];
  const cliente = clienteFirestore({ progetto: PROGETTO, token: t.token, fetchImpl: s.fetchImpl, attendi: async (ms) => { attese.push(ms); } });
  const conto = await contaRaccolte(cliente);
  assert.deepEqual(conto.raccolte, ATTESO);
  assert.deepEqual(attese, [1000, 2000]);
  assert.deepEqual(t.chiamate, [{ nuovo: false }, { nuovo: true }]);

  const no = serverFinto(DOCUMENTI, { guasti: [{ status: 403, corpo: { error: { status: 'PERMISSION_DENIED', message: 'Missing or insufficient permissions.' } } }] });
  await assert.rejects(
    contaRaccolte(clienteFirestore({ progetto: PROGETTO, token: async () => 't', fetchImpl: no.fetchImpl, attendi: senzaAttese })),
    (e) => /403/.test(e.message) && e.message.includes(PROGETTO) && /gcloud auth list/.test(e.message) && /insufficient permissions/.test(e.message),
  );
  assert.equal(no.richieste.length, 1, 'un no non si ritenta');

  const sempre = serverFinto(DOCUMENTI, { guasti: Array.from({ length: 10 }, () => ({ status: 503 })) });
  await assert.rejects(contaRaccolte(clienteFirestore({ progetto: PROGETTO, token: async () => 't', fetchImpl: sempre.fetchImpl, attendi: senzaAttese })), /503/);
  assert.equal(sempre.richieste.length, 6, 'cinque tentativi in più, poi si ferma');

  const scaduto = serverFinto(DOCUMENTI, { guasti: [{ status: 401 }, { status: 401 }] });
  const t2 = tokenFinto();
  await assert.rejects(contaRaccolte(clienteFirestore({ progetto: PROGETTO, token: t2.token, fetchImpl: scaduto.fetchImpl, attendi: senzaAttese })),
    (e) => /401/.test(e.message) && /gcloud auth login/.test(e.message));
  assert.equal(t2.chiamate.length, 2, 'un token nuovo, una volta sola');
});

test('il token si chiede a gcloud: da cmd.exe su Windows, diretto su Mac e Linux', () => {
  assert.deepEqual(comandoToken('win32'), { riga: 'gcloud auth print-access-token', shell: true });
  for (const s of ['darwin', 'linux']) {
    assert.deepEqual(comandoToken(s), { file: 'gcloud', argomenti: ['auth', 'print-access-token'], shell: false });
  }
  const visti = [];
  assert.equal(tokenDaGcloud({ sistema: 'win32', esegui: (c) => { visti.push(c); return 'ya29.abc\r\n'; } }), 'ya29.abc');
  assert.equal(visti[0].shell, true);
  assert.throws(() => tokenDaGcloud({ sistema: 'linux', esegui: () => { throw Object.assign(new Error('spawn gcloud ENOENT'), { code: 'ENOENT' }); } }),
    /installa Google Cloud SDK/);
  assert.throws(() => tokenDaGcloud({ sistema: 'linux', esegui: () => { throw Object.assign(new Error('exit 1'), { stderr: 'ERROR: (gcloud.auth.print-access-token) You do not currently have an active account selected.\n' }); } }),
    (e) => /active account/.test(e.message) && /gcloud auth login/.test(e.message));
  assert.throws(() => tokenDaGcloud({ sistema: 'darwin', esegui: () => '\n' }), /uscita vuota/);
});

test('riga di comando: progetto e database controllati, --confronta con zero, uno o due file', () => {
  const o = leggiArgomenti([]);
  assert.equal(o.progetto, PROGETTO_FILO);
  assert.equal(o.database, '(default)');
  assert.equal(o.confronta, null);
  assert.deepEqual(leggiArgomenti(['--confronta', '--dettaglio']).confronta, []);
  assert.deepEqual(leggiArgomenti(['--confronta', 'a.json']).confronta, ['a.json']);
  assert.deepEqual(leggiArgomenti(['--confronta', 'a.json', 'b.json']).confronta, ['a.json', 'b.json']);
  assert.match(leggiArgomenti(['--confronta', 'a', 'b', 'c']).errore, /"c" non vale/);
  assert.equal(leggiArgomenti(['--progetto', 'filo-prova-eur3', '--database', 'copia-1']).database, 'copia-1');
  assert.match(leggiArgomenti(['--progetto']).errore, /vuole un valore/);
  assert.match(leggiArgomenti(['--progetto', '  ']).errore, /vuole un valore/);
  for (const brutto of ['Filo', 'a/b', 'x', 'progetto-con-un-nome-troppo-lungo-davvero', 'filo-8b9cb/../x']) {
    assert.match(leggiArgomenti(['--progetto', brutto]).errore, /non è l'id di un progetto/, brutto);
  }
  assert.match(leggiArgomenti(['--database', '(altro)']).errore, /non è l'id di un database/);
  assert.match(leggiArgomenti(['--force']).errore, /non vale qui/);
  assert.equal(leggiArgomenti(['--aiuto']).aiuto, true);
});

test('l\'elenco: per gruppo di serie, raccolta per raccolta con --dettaglio, totale in fondo', () => {
  assert.equal(raccoltaDi(`${RADICE}/a/b/c/d`, RADICE), 'a/b/c');
  assert.throws(() => raccoltaDi('projects/altro/databases/(default)/documents/a/b', RADICE), /fuori dal database/);
  assert.equal(gruppoDi('feedback/abc/note/1/risposte'), 'feedback/*/note/*/risposte');
  assert.deepEqual(perGruppo(ATTESO)['feedback/*/note'], { documenti: 4, raccolte: 3 });
  const conto = { totale: 15, raccolte: ATTESO };
  assert.deepEqual(righeElenco(conto), [
    ' 1  Zeta',
    ' 2  config',
    ' 3  feedback',
    ' 1  feedback-public',
    ' 4  feedback/*/note  (3 raccolte)',
    ' 1  feedback/*/note/*/risposte  (1 raccolta)',
    ' 3  paths/*/entries  (2 raccolte)',
    '15  totale',
  ]);
  const det = righeElenco(conto, { dettaglio: true });
  assert.equal(det.length, Object.keys(ATTESO).length + 1);
  assert.ok(det.includes(' 1  feedback/c/note'));
  assert.deepEqual(righeElenco({ totale: 0, raccolte: {} }), ['0  totale']);
});

test('il confronto dice cosa manca, cosa è cambiato e cosa è in più', () => {
  const prima = { raccolte: ATTESO };
  assert.deepEqual(righeConfronto(confronta(prima, { raccolte: { ...ATTESO } })), ['UGUALE: 10 raccolte, 15 documenti, nessuna differenza.']);
  const dopo = { ...ATTESO, config: 1, 'feedback/zz/note': 4 };
  delete dopo['feedback/c/note'];
  const esito = confronta(prima, { raccolte: dopo });
  assert.equal(esito.uguale, false);
  assert.deepEqual(esito.diverse, [
    { raccolta: 'config', prima: 2, dopo: 1 },
    { raccolta: 'feedback/c/note', prima: 1, dopo: 0 },
    { raccolta: 'feedback/zz/note', prima: 0, dopo: 4 },
  ]);
  assert.equal(esito.mancano, 2, 'i quattro in più altrove non coprono i due che mancano');
  assert.equal(esito.inPiu, 4);
  assert.deepEqual(righeConfronto(esito), [
    'DIVERSO: 3 raccolte su 11 non tornano: mancano 2 documenti, 4 in più (15 prima, 17 dopo).',
    '  config: 2 → 1 (-1)',
    '  feedback/*/note: 1 → 4 (+3), in 2 raccolte',
    'Le sottoraccolte che non tornano:',
    '  feedback/c/note: manca (prima 1)',
    '  feedback/zz/note: in più (4, prima non c\'era)',
  ]);
  assert.equal(righeConfronto(confronta({ raccolte: { a: 2 } }, { raccolte: { a: 1 } }))[0],
    'DIVERSO: 1 raccolta su 1 non torna: manca 1 documento, 0 in più (2 prima, 1 dopo).');
  const molte = {};
  for (let i = 0; i < 40; i++) molte[`paths/d${String(i).padStart(2, '0')}/entries`] = 1;
  const tante = confronta({ raccolte: molte }, { raccolte: {} });
  const corte = righeConfronto(tante);
  assert.equal(corte[corte.length - 1], '  … e altre 10: --dettaglio le mostra tutte.');
  assert.equal(righeConfronto(tante, { dettaglio: true }).filter((r) => r.startsWith('  paths/d')).length, 40);
  // Una raccolta che si chiama come una proprietà di ogni oggetto JavaScript resta una raccolta.
  assert.equal(confronta({ raccolte: { constructor: 2 } }, { raccolte: {} }).diverse[0].prima, 2);
  assert.deepEqual(confronta({ raccolte: {} }, { raccolte: { toString: 1 } }).diverse, [{ raccolta: 'toString', prima: 0, dopo: 1 }]);
});

test('i conteggi salvati: si rileggono, e senza file si confronta con l\'ultimo dello stesso progetto e database', () => {
  const dir = cartellaTemporanea('conta-documenti-');
  const scrivi = (nome, j) => { const f = join(dir, nome); writeFileSync(f, typeof j === 'string' ? j : JSON.stringify(j)); return f; };
  const buono = { formato: FORMATO, progetto: PROGETTO, database: '(default)', contatoIl: '2026-11-01T10:00:00.000Z', totale: 99, raccolte: { a: 2, 'a/x/b': 3 } };
  assert.equal(leggiConteggio(scrivi('b.json', `﻿${JSON.stringify(buono)}`)).totale, 5, 'il totale si rifà dai numeri');
  assert.throws(() => leggiConteggio(scrivi('c.json', 'non json')), /non si legge come conteggio/);
  assert.throws(() => leggiConteggio(scrivi('d.json', { raccolte: {} })), /non è un conteggio salvato/);
  assert.throws(() => leggiConteggio(scrivi('e.json', { ...buono, raccolte: { a: -1 } })), /non è un conteggio/);

  const ore = ['2026-11-01T09:00:00.000Z', '2026-11-01T21:30:00.000Z', '2026-11-01T10:00:00.000Z'].map((s) => new Date(s));
  for (const ora of ore) scrivi(nomeFile(PROGETTO, '(default)', ora), buono);
  scrivi(nomeFile(PROGETTO, 'copia-1', new Date('2026-11-02T00:00:00Z')), buono);
  scrivi(nomeFile('filo-8b9cb', '(default)', new Date('2026-11-03T00:00:00Z')), buono);
  assert.doesNotMatch(nomeFile(PROGETTO, '(default)', ore[0]), /:/, 'Windows non vuole i due punti nei nomi');
  assert.equal(ultimoSalvato(dir, PROGETTO, '(default)'), join(dir, nomeFile(PROGETTO, '(default)', ore[1])));
  assert.equal(ultimoSalvato(dir, 'filo-altro', '(default)'), null);
  assert.equal(ultimoSalvato(join(dir, 'non-ce'), PROGETTO, '(default)'), null);
  assert.equal(cartellaConteggi(dir), join(dir, 'filo-conteggi-firestore'));
});

function uscita() {
  const righe = [];
  const avvisi = [];
  return { righe, avvisi, out: (r) => righe.push(String(r)), err: { write: (t) => { avvisi.push(String(t)); } } };
}

test('prima dell\'export e dopo l\'import: UGUALE se non manca niente, DIVERSO e cosa manca se manca', async () => {
  const casa = cartellaTemporanea('conta-documenti-casa-');
  const cartella = cartellaConteggi(casa);
  const prima = uscita();
  const s1 = serverFinto();
  const deps = (s, u, quando) => ({ out: u.out, err: u.err, casa, fetchImpl: s.fetchImpl, token: async () => 't', attendi: senzaAttese, ora: () => new Date(quando) });

  assert.equal(await main(['--progetto', PROGETTO], deps(s1, prima, '2026-11-01T09:00:00Z')), 0);
  assert.equal(prima.righe[prima.righe.length - 1], '15  totale');
  assert.ok(prima.avvisi.some((a) => /Solo lettura/.test(a)));
  assert.ok(prima.avvisi.some((a) => /Documenti letti dal server in questo giro: \d+/.test(a)), 'il costo a schermo');
  const salvati = readdirSync(cartella);
  assert.equal(salvati.length, 1);
  const doc = JSON.parse(readFileSync(join(cartella, salvati[0]), 'utf8'));
  assert.deepEqual(doc.raccolte, ATTESO);
  assert.equal(doc.progetto, PROGETTO);

  const dopo = uscita();
  assert.equal(await main(['--progetto', PROGETTO, '--confronta'], deps(serverFinto(), dopo, '2026-11-01T11:00:00Z')), 0);
  assert.equal(dopo.righe[dopo.righe.length - 1], 'UGUALE: 10 raccolte, 15 documenti, nessuna differenza.');
  assert.ok(dopo.righe.some((r) => r.startsWith('Confronto: prima filo-prova, database (default)')));

  const manca = uscita();
  const ridotto = serverFinto(DOCUMENTI.filter((d) => d !== 'feedback/c/note/1' && d !== 'config/secrets'));
  assert.equal(await main(['--progetto', PROGETTO, '--confronta'], deps(ridotto, manca, '2026-11-01T12:00:00Z')), 1);
  assert.ok(manca.righe.includes('DIVERSO: 2 raccolte su 10 non tornano: mancano 2 documenti, 0 in più (15 prima, 13 dopo).'), manca.righe.join('\n'));
  assert.ok(manca.righe.includes('  feedback/c/note: manca (prima 1)'));
  assert.ok(manca.righe.includes('  config: 2 → 1 (-1)'));

  const [a, b] = readdirSync(cartella).sort().map((n) => join(cartella, n));
  const file = uscita();
  const nessunaRete = async () => { throw new Error('due file si confrontano senza leggere il database'); };
  assert.equal(await main(['--confronta', a, b], { out: file.out, err: file.err, casa, fetchImpl: nessunaRete, token: nessunaRete }), 0);
  assert.equal(file.righe[file.righe.length - 1], 'UGUALE: 10 raccolte, 15 documenti, nessuna differenza.');
});

test('un conteggio interrotto non si salva, e senza un conteggio da confrontare non si legge niente', async () => {
  const casa = cartellaTemporanea('conta-documenti-guasto-');
  const u = uscita();
  const no = serverFinto(DOCUMENTI, { guasti: [{ status: 200, corpo: { collectionIds: ['feedback'] } }, { status: 403 }] });
  assert.equal(await main(['--progetto', PROGETTO], { out: u.out, err: u.err, casa, fetchImpl: no.fetchImpl, token: async () => 't', attendi: senzaAttese }), 1);
  assert.ok(u.avvisi.some((a) => /Conteggio interrotto: Firestore ha detto no \(403\)/.test(a) && /Niente salvato/.test(a)), u.avvisi.join(''));
  assert.equal(existsSync(cartellaConteggi(casa)), false);

  const v = uscita();
  const s = serverFinto();
  assert.equal(await main(['--progetto', PROGETTO, '--confronta'], { out: v.out, err: v.err, casa, fetchImpl: s.fetchImpl, token: async () => 't' }), 2);
  assert.match(v.avvisi.join(''), /Nessun conteggio salvato di filo-prova/);
  assert.equal(s.richieste.length, 0);
});

test('il comando parte da solo dalla riga di comando', () => {
  const script = join(ROOT, 'scripts', 'conta-documenti.mjs');
  const aiuto = spawnSync(process.execPath, [script, '--aiuto'], { encoding: 'utf8' });
  assert.equal(aiuto.status, 0, aiuto.stderr);
  assert.match(aiuto.stdout, /npm run db:conta/);
  const brutto = spawnSync(process.execPath, [script, '--progetto', 'NON-VA'], { encoding: 'utf8' });
  assert.equal(brutto.status, 2);
  assert.match(brutto.stderr, /non è l'id di un progetto/);
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['db:conta'], 'node scripts/conta-documenti.mjs');
});
