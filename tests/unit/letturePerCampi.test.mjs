// Sentinella: una scansione della collezione chiede i CAMPI che usa.
//
// Perché conta. Un feedback pesa qualche KB — testo cifrato, note, allegati — e
// gli script di manutenzione ne guardano tre o quattro campi. Lanciati qualche
// volta nello stesso pomeriggio su una collezione intera fanno una raffica: a
// settembre 2026 un solo giorno ha fatto il 40% del conto mensile (#680).
//
// Il freno guarda la RICHIESTA che parte (scripts/lib/freno-letture.mjs), non
// come è scritto il comando: ogni grafia nuova produce la stessa richiesta, e un
// freno sul testo ne lasciava passare cinque (#680.1). Qui si prova quello.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import {
  scansioneSenzaCampi, conFreno, ScansioneSenzaCampi, DOCUMENTI_SENZA_CAMPI_MAX,
} from '../../scripts/lib/freno-letture.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SCRIPTS = join(ROOT, 'scripts');
const require = createRequire(import.meta.url);
require(join(ROOT, 'src', 'shared', 'feedback.js'));
require(join(ROOT, 'src', 'shared', 'manageReview.js'));
require(join(ROOT, 'src', 'shared', 'boardArchive.js'));
require(join(ROOT, 'src', 'shared', 'feedbackPublicView.js'));

const FB = globalThis.SN_FEEDBACK;
const BA = globalThis.SN_BOARD_ARCHIVE;
const BASE = 'https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents';

// La rete finta sotto il freno: registra quello che le arriva davvero.
async function sottoIlFreno(fn) {
  const arrivate = [];
  const vera = globalThis.fetch;
  globalThis.fetch = conFreno(async (input, init) => {
    arrivate.push({ url: String(input), init });
    return { ok: true, status: 200, json: async () => [], text: async () => '' };
  });
  try {
    let errore = null;
    try { await fn(); } catch (e) { errore = e; }
    return { arrivate, errore };
  } finally { globalThis.fetch = vera; }
}

async function modulo(codice) {
  return import(`data:text/javascript,${encodeURIComponent(codice)}`);
}

// Lo strumento che il prossimo scriverà senza sapere del freno, in ogni grafia
// trovata finora. Ognuna scarica la collezione intera; accanto, la stessa
// scansione che dice i campi, che deve passare.
const GRAFIE = {
  'la grafia degli script di oggi': [
    'const FB = globalThis.SN_FEEDBACK; export const tutti = () => FB.listAllPaged({ idToken: "t" });',
    'const FB = globalThis.SN_FEEDBACK; export const tutti = () => FB.listAllPaged({ idToken: "t", fields: ["seq"] });',
  ],
  'col punto di domanda (FB?.listAllPaged)': [
    'const FB = globalThis.SN_FEEDBACK; export const tutti = () => FB?.listAllPaged({ idToken: "t" });',
    'const FB = globalThis.SN_FEEDBACK; export const tutti = () => FB?.listAllPaged({ idToken: "t", fields: ["seq"] });',
  ],
  'il metodo preso dal modulo e chiamato da solo': [
    'const { listAll } = globalThis.SN_FEEDBACK; export const tutti = () => listAll({ idToken: "t" });',
    'const { listAll } = globalThis.SN_FEEDBACK; export const tutti = () => listAll({ idToken: "t", fields: ["seq"] });',
  ],
  'la domanda al database scritta dentro la richiesta': [
    `export const tutti = () => fetch("${BASE}:runQuery?key=k", { method: "POST",
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "feedback" }], limit: 500 } }) });`,
    `export const tutti = () => fetch("${BASE}:runQuery?key=k", { method: "POST",
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "feedback" }], limit: 500, select: { fields: [{ fieldPath: "seq" }] } } }) });`,
  ],
  'la chiave davanti al numero di pagina': [
    `export const tutti = () => fetch(\`${BASE}/feedback?key=k&pageSize=300\`);`,
    `export const tutti = () => fetch(\`${BASE}/feedback?key=k&pageSize=300&mask.fieldPaths=seq\`);`,
  ],
  'l\'indirizzo messo insieme con un più': [
    `const qs = "pageSize=300"; export const tutti = () => fetch("${BASE}" + "/feedback?" + qs);`,
    `const qs = "pageSize=300&mask.fieldPaths=seq"; export const tutti = () => fetch("${BASE}" + "/feedback?" + qs);`,
  ],
  'le schede pubbliche, senza credenziali': [
    'export const tutti = () => globalThis.SN_FEEDBACK.listAllPublicPaged({});',
    'export const tutti = () => globalThis.SN_FEEDBACK.listAllPublicPaged({ fields: ["votes"] });',
  ],
};

for (const [come, [nudo, proiettato]] of Object.entries(GRAFIE)) {
  test(`il freno ferma la scansione senza campi prima della rete: ${come}`, async () => {
    const senza = await sottoIlFreno(async () => (await modulo(nudo)).tutti());
    assert.ok(senza.errore instanceof ScansioneSenzaCampi,
      `«${come}» doveva fermarsi, invece: ${senza.errore ? senza.errore.message : 'nessun errore'}`);
    assert.equal(senza.arrivate.length, 0, 'la richiesta è arrivata alla rete: il documento intero è già pagato');
    const con = await sottoIlFreno(async () => (await modulo(proiettato)).tutti());
    assert.equal(con.errore, null, `«${come}» dice i campi e il freno lo ferma lo stesso: ${con.errore && con.errore.message}`);
    assert.ok(con.arrivate.length >= 1, 'la scansione con i campi non è partita');
  });
}

test('il freno lascia passare quello che non è una scansione di documenti interi', () => {
  const passa = [
    [`${BASE}/feedback/abc`, {}],
    [`${BASE}/config/routines?key=k`, {}],
    [`${BASE}/feedback/abc?updateMask.fieldPaths=status`, { method: 'PATCH', body: '{}' }],
    [`${BASE}:runAggregationQuery?key=k`, { method: 'POST', body: JSON.stringify({ structuredAggregationQuery: { structuredQuery: { from: [{ collectionId: 'feedback' }] } } }) }],
    [`${BASE}:batchGet?key=k`, { method: 'POST', body: JSON.stringify({ documents: [`${BASE}/feedback/a`] }) }],
    // Il massimo di `seq`: un documento, niente cursore.
    [`${BASE}:runQuery?key=k`, { method: 'POST', body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'feedback' }], limit: 1 } }) }],
    [`${BASE}/feedback?pageSize=${DOCUMENTI_SENZA_CAMPI_MAX}`, {}],
    ['https://securetoken.googleapis.com/v1/token?key=k', { method: 'POST', body: 'grant_type=refresh_token' }],
    ['https://example.com/feedback?pageSize=300', {}],
  ];
  for (const [url, init] of passa) assert.equal(scansioneSenzaCampi(url, init), null, `fermata a torto: ${url}`);
});

test('una scansione a pagine piccole si ferma alla seconda pagina: il cursore dice che è un giro intero', () => {
  assert.match(String(scansioneSenzaCampi(`${BASE}/feedback?pageSize=5&pageToken=abc`, {})), /feedback/);
  const pagina = { structuredQuery: { from: [{ collectionId: 'credits' }], limit: 5, startAt: { values: [] } } };
  assert.match(String(scansioneSenzaCampi(`${BASE}:runQuery`, { method: 'POST', body: JSON.stringify(pagina) })), /credits/);
  // Nessun limite è il limite del server: una collezione intera.
  const tutta = { structuredQuery: { from: [{ collectionId: 'feedback-public' }] } };
  assert.match(String(scansioneSenzaCampi(`${BASE}:runQuery`, { method: 'POST', body: JSON.stringify(tutta) })), /feedback-public/);
  assert.match(String(scansioneSenzaCampi(new URL(`${BASE}/feedback`), undefined)), /feedback/);
});

test('chi prende le credenziali di Firestore prende anche il freno', () => {
  // In un processo a parte: qui il freno è già caricato dall'import in testa.
  const auth = pathToFileURL(join(SCRIPTS, 'lib', 'firestore-auth.mjs')).href;
  const esito = execFileSync(process.execPath, ['--input-type=module', '-e',
    `await import(${JSON.stringify(auth)}); process.stdout.write(String(Boolean(globalThis.fetch[Symbol.for('filo.frenoLetture')])));`,
  ], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(esito, 'true', 'firestore-auth non installa il freno: le scansioni degli script partono senza');
});

// Tutta la cartella degli strumenti, sottocartelle comprese: gli attrezzi
// condivisi stanno in `lib/`, ed è lì che finirà la prossima scansione.
function scriptDiManutenzione(dir = SCRIPTS, prefisso = '') {
  const out = [];
  for (const voce of readdirSync(dir, { withFileTypes: true })) {
    const nome = `${prefisso}${voce.name}`;
    if (voce.isDirectory()) { out.push(...scriptDiManutenzione(join(dir, voce.name), `${nome}/`)); continue; }
    if (!voce.name.endsWith('.mjs')) continue;
    out.push({ nome, testo: readFileSync(join(dir, voce.name), 'utf8') });
  }
  return out;
}

test('ogni script che può leggere le segnalazioni carica il freno prima di farlo', () => {
  // La collezione privata si legge solo con le credenziali di firestore-auth,
  // che il freno lo porta con sé. Le schede pubbliche no: chi carica il modulo
  // dei feedback le può scansionare senza credenziali, quindi importa il freno
  // da sé, in testa e non dentro un ramo.
  const importaFreno = /^\s*import\s+(?:[^;]*?\sfrom\s+)?['"][^'"]*(?:freno-letture|firestore-auth)\.mjs['"]/m;
  const parlaConFirestore = /['"/]feedback\.js['"]|firestore\.googleapis/;
  const visti = scriptDiManutenzione();
  assert.ok(visti.some((f) => f.nome === 'lib/firestore-auth.mjs'), `lib/ non guardata: ${visti.map((f) => f.nome).join(', ')}`);
  const scoperti = visti.filter((f) => parlaConFirestore.test(f.testo) && !importaFreno.test(f.testo)).map((f) => f.nome);
  assert.deepEqual(scoperti, [], `questi script leggono Firestore senza il freno sulle scansioni: ${scoperti.join(', ')}`);
});

test('ogni script di manutenzione stampa quanti documenti ha letto', () => {
  // Chi lancia lo script deve vedere il costo sullo schermo, non in fattura.
  const MANUTENZIONE = ['auto-archive.mjs', 'backfill-feedback-numbers.mjs', 'migrate-status.mjs', 'migrate-status-padding.mjs'];
  const muti = [];
  for (const nome of MANUTENZIONE) {
    const testo = readFileSync(join(SCRIPTS, nome), 'utf8');
    if (!/contatoreLetture|rigaLetture/.test(testo)) muti.push(nome);
  }
  assert.deepEqual(muti, [], `questi script non dicono quanto è costato il giro: ${muti.join(', ')}`);
});

// ── I campi chiesti sono quelli che la decisione legge ──────────────────────

test('CAMPI_DECISIONE copre tutto quello che l\'archiviazione automatica guarda', () => {
  // Un campo letto dalla decisione e dimenticato nell'elenco arriverebbe
  // sempre assente: nessun errore, e un fix non archiviato per sempre.
  const sorgente = readFileSync(join(ROOT, 'src', 'shared', 'boardArchive.js'), 'utf8');
  const letti = new Set();
  for (const m of sorgente.matchAll(/\bfb\.([A-Za-z_][A-Za-z0-9_]*)/g)) letti.add(m[1]);
  const fuori = [...letti].filter((c) => c !== '_id' && !BA.CAMPI_DECISIONE.includes(c));
  assert.deepEqual(fuori, [],
    `boardArchive legge questi campi ma non sono in CAMPI_DECISIONE: ${fuori.join(', ')}`);
});

test('la scansione dell\'archiviazione chiede i campi della decisione, non il documento intero', () => {
  const testo = readFileSync(join(SCRIPTS, 'auto-archive.mjs'), 'utf8');
  assert.match(testo, /CAMPI_SEGNALAZIONI\s*=\s*\[\s*\.\.\.BA\.CAMPI_DECISIONE/,
    'i campi della scansione devono venire dalla decisione, non da una copia scritta a mano');
  assert.match(testo, /listAllPublic\(\{\s*fields:\s*\[\.\.\.PV\.USER_FIELDS\]/,
    'delle schede pubbliche servono solo i campi degli utenti: è l\'unica cosa che mergeUserFields guarda');
});

// ── La proiezione arriva davvero alla richiesta ─────────────────────────────

test('listAllPaged porta i campi fino a ogni pagina del cursore', async () => {
  const chieste = [];
  const vera = FB.list;
  FB.list = async (opts) => { chieste.push(opts); return []; };
  try {
    await FB.listAllPaged({ fields: ['seq', 'votes'] });
  } finally { FB.list = vera; }
  assert.equal(chieste.length, 1);
  assert.deepEqual(chieste[0].fields, ['seq', 'votes'],
    'senza inoltro la lettura completa scaricava documenti interi anche chiedendo due campi');
});

test('listAllPublic porta i campi, e la memoria breve non scambia una proiezione per il documento intero', async () => {
  const chieste = [];
  const vera = FB.listPublic;
  FB.listPublic = async (opts) => { chieste.push(opts); return []; };
  try {
    await FB.listAllPublic({ fields: ['votes'] });
    assert.deepEqual(chieste[0].fields, ['votes']);
    // Stessa richiesta: risponde la memoria, niente rete.
    await FB.listAllPublic({ fields: ['votes'] });
    assert.equal(chieste.length, 1, 'la memoria breve non ha risposto');
    // Richiesta DIVERSA (tutti i campi): la memoria non deve rispondere con
    // righe mutilate.
    await FB.listAllPublic({});
    assert.equal(chieste.length, 2, 'chi vuole il documento intero si è ritrovato una proiezione');
    assert.equal(chieste[1].fields, null);
  } finally {
    FB.listPublic = vera;
    FB.forgetAllPublic();
  }
});

test('una riga arrivata da una proiezione resta marcata anche passando dal cursore', async () => {
  // Chi mostra il dettaglio deve poter distinguere «non ha note» da «le note
  // non le ho chieste», anche quando la pagina è arrivata dal cursore sul nome.
  const rows = await new Promise((ok) => {
    const veraFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ([{ document: { name: 'x/y/documents/feedback/a1', fields: { seq: { integerValue: '7' } } } }]),
    });
    FB.list({ afterName: '', fields: ['seq'] }).then((r) => { globalThis.fetch = veraFetch; ok(r); });
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]._proiezione, true);
});

// ── Il conteggio: chiedere «quanti sono» invece di scaricarli per contarli ──

test('il conteggio chiede un COUNT al server, col filtro quando serve', async () => {
  const { corpoConteggio, numeroDaRisposta, contaDocumenti } = await import('../../scripts/lib/firestore-conta.mjs');
  const corpo = corpoConteggio('feedback', { field: 'seq', op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: '1' } });
  assert.deepEqual(corpo.structuredAggregationQuery.aggregations, [{ alias: 'quanti', count: {} }]);
  assert.equal(corpo.structuredAggregationQuery.structuredQuery.where.fieldFilter.field.fieldPath, 'seq');
  assert.equal(corpo.structuredAggregationQuery.structuredQuery.where.fieldFilter.op, 'GREATER_THAN_OR_EQUAL');
  assert.equal(corpoConteggio('feedback').structuredAggregationQuery.structuredQuery.where, undefined);
  assert.equal(numeroDaRisposta([{ result: { aggregateFields: { quanti: { integerValue: '763' } } } }]), 763);
  assert.ok(Number.isNaN(numeroDaRisposta([])));
  // Un server che non sa contare non deve fermare una manutenzione: torna NaN e
  // chi chiama scansiona, dichiarandolo.
  const ko = await contaDocumenti('http://b', 'k', 'feedback', { fetchImpl: async () => ({ ok: false, status: 400 }) });
  assert.ok(Number.isNaN(ko));
  const rotto = await contaDocumenti('http://b', 'k', 'feedback', { fetchImpl: async () => { throw new Error('rete'); } });
  assert.ok(Number.isNaN(rotto));
});

test('la riga del costo dice un numero, e non diventa NaN per un conto che non si conosce', async () => {
  const { contatoreLetture, rigaLetture } = await import('../../scripts/lib/letture.mjs');
  const c = contatoreLetture();
  c.aggiungi(763, 'segnalazioni');
  c.aggiungi(undefined, 'schede');
  c.aggiungi(550, 'schede');
  assert.equal(c.totale, 1313);
  assert.match(c.riga(), /1313/);
  assert.match(c.riga(), /segnalazioni 763/);
  assert.equal(rigaLetture(0), 'Documenti letti dal server in questo giro: 0.');
});

// ── L'archiviazione automatica decide la stessa cosa, pagando meno ──────────

test('la proiezione non cambia il verdetto: stessi archiviati, stessi segnalati', async () => {
  const { runAutoArchive } = await import('../../scripts/auto-archive.mjs');
  const { cartellaTemporanea } = await import('../helpers/percorsi.mjs');
  const ORA = Date.parse('2026-09-20T12:00:00Z');
  const vecchio = new Date(ORA - 5 * 24 * 3600_000).toISOString();

  // Tre casi: uno da archiviare, uno da segnalare, uno che l'owner ha
  // esplicitamente deciso di non archiviare.
  const righe = [
    { _id: 'ok', status: 'done', resolvedAt: vecchio, resolvedInVersion: '1.0.0', seq: 1, subSeq: 0 },
    { _id: 'rotto', status: 'done', resolvedAt: vecchio, resolvedInVersion: '1.0.0', seq: 2, subSeq: 0 },
    { _id: 'tenuto', status: 'done', resolvedAt: vecchio, resolvedInVersion: '1.0.0', seq: 3, subSeq: 0, archiveOverride: 'keep_open' },
  ];
  const voto = (esito) => ({ a: { vote: esito, at: vecchio, weight: 3 }, b: { vote: esito, at: vecchio, weight: 3 } });
  const schede = [
    { _id: 'ok', votes: voto('works') },
    { _id: 'rotto', votes: voto('broken') },
    { _id: 'tenuto', votes: voto('works') },
  ];

  const chieste = { righe: null, schede: null };
  const vere = { list: FB.list, listPublic: FB.listPublic };
  FB.list = async (o) => { chieste.righe = o.fields; return o.afterName ? [] : righe.map((r) => ({ ...r })); };
  FB.listPublic = async (o) => { chieste.schede = o.fields; return o.afterName ? [] : schede.map((c) => ({ ...c })); };
  try {
    const r = await runAutoArchive({
      dryRun: true, now: ORA, releasedVersion: '1.0.0', bearer: 'tok',
      copiaDir: cartellaTemporanea('auto-archive-campi-'),
    });
    assert.deepEqual(r.toArchive.map((a) => a.id), ['ok']);
    assert.deepEqual(r.toFlag, ['rotto'], 'il segnale «gli utenti dicono che non va» non deve sparire');
    // I campi che sono stati chiesti sono quelli che la decisione legge, più il
    // numero leggibile della riga stampata: niente testo, note o allegati.
    for (const c of BA.CAMPI_DECISIONE) assert.ok(chieste.righe.includes(c), `manca ${c}`);
    assert.ok(!chieste.righe.includes('text') && !chieste.righe.includes('notes') && !chieste.righe.includes('images'));
    assert.deepEqual(chieste.schede, ['votes', 'reopenRequests']);
    assert.match(r.rigaLetture, /segnalazioni 3/);
    assert.match(r.rigaLetture, /schede 3/);
  } finally {
    FB.list = vere.list;
    FB.listPublic = vere.listPublic;
    FB.forgetAllPublic();
  }
});
