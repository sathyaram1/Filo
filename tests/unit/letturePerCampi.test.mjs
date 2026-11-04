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
async function sottoIlFreno(fn, risponde = () => []) {
  const arrivate = [];
  const vera = globalThis.fetch;
  globalThis.fetch = conFreno(async (input, init) => {
    arrivate.push({ url: String(input), init });
    const dati = await risponde(input, init);
    return { ok: true, status: 200, json: async () => dati, text: async () => '' };
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
  // #1335: le forme che passavano davanti al freno di #680.1.
  'la domanda mandata come oggetto richiesta già pronto': [
    `export const tutti = () => fetch(new Request("${BASE}:runQuery?key=k", { method: "POST",
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "feedback" }], limit: 500 } }) }));`,
    `export const tutti = () => fetch(new Request("${BASE}:runQuery?key=k", { method: "POST",
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "feedback" }], limit: 500, select: { fields: [{ fieldPath: "seq" }] } } }) }));`,
  ],
  'il contenuto come blocco binario invece che testo': [
    `export const tutti = () => fetch("${BASE}:runQuery?key=k", { method: "POST",
      body: new TextEncoder().encode(JSON.stringify({ structuredQuery: { from: [{ collectionId: "feedback" }], limit: 500 } })).buffer });`,
    `export const tutti = () => fetch("${BASE}:runQuery?key=k", { method: "POST",
      body: new TextEncoder().encode(JSON.stringify({ structuredQuery: { from: [{ collectionId: "feedback" }], limit: 500, select: { fields: [{ fieldPath: "seq" }] } } })).buffer });`,
  ],
  'il contenuto come Blob': [
    `export const tutti = () => fetch("${BASE}:runQuery?key=k", { method: "POST",
      body: new Blob([JSON.stringify({ structuredQuery: { from: [{ collectionId: "feedback" }], limit: 500 } })]) });`,
    `export const tutti = () => fetch("${BASE}:runQuery?key=k", { method: "POST",
      body: new Blob([JSON.stringify({ structuredQuery: { from: [{ collectionId: "feedback" }], limit: 500, select: { fields: [{ fieldPath: "seq" }] } } })]) });`,
  ],
  'la scelta dei campi presente ma vuota': [
    `export const tutti = () => fetch("${BASE}:runQuery?key=k", { method: "POST",
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "feedback" }], limit: 500, select: { fields: [] } } }) });`,
    `export const tutti = () => fetch("${BASE}:runQuery?key=k", { method: "POST",
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "feedback" }], limit: 500, select: { fields: [{ fieldPath: "seq" }] } } }) });`,
  ],
  'la maschera vuota nella lista REST': [
    `export const tutti = () => fetch(\`${BASE}/feedback?key=k&pageSize=300&mask.fieldPaths=%20\`);`,
    `export const tutti = () => fetch(\`${BASE}/feedback?key=k&pageSize=300&mask.fieldPaths=seq\`);`,
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

// Le letture piccole contano nel giro: dieci documenti interi passano, il pezzo che porta oltre si ferma (#1335).
test('il freno conta il giro intero: pagine da dieci avanzate con un filtro sul numero invece del cursore', async () => {
  const pagine = (select) => `export const tutti = async () => {
    for (let dopo = 0; dopo < 30; dopo += 10) {
      await fetch("${BASE}:runQuery?key=k", { method: "POST", body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: "feedback" }], orderBy: [{ field: { fieldPath: "seq" } }], limit: 10, ${select}
        where: { fieldFilter: { field: { fieldPath: "seq" }, op: "GREATER_THAN", value: { integerValue: String(dopo) } } } } }) });
    }
  };`;
  const senza = await sottoIlFreno(async () => (await modulo(pagine(''))).tutti());
  assert.ok(senza.errore instanceof ScansioneSenzaCampi, `il giro a pagine col filtro passa: ${senza.errore && senza.errore.message}`);
  assert.match(senza.errore.message, /già chiesti 10 documenti interi/);
  assert.equal(senza.arrivate.length, 1, 'oltre la prima pagina da dieci non doveva partire niente');
  const con = await sottoIlFreno(async () => (await modulo(pagine('select: { fields: [{ fieldPath: "seq" }] },'))).tutti());
  assert.equal(con.errore, null, con.errore && con.errore.message);
  assert.equal(con.arrivate.length, 3);
  // Un freno nuovo, un giro nuovo: il massimo di `seq` resta una lettura mirata.
  const mirata = await sottoIlFreno(async () => fetch(`${BASE}:runQuery?key=k`, { method: 'POST',
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'feedback' }], orderBy: [{ field: { fieldPath: 'seq' }, direction: 'DESCENDING' }], limit: 1 } }) }));
  assert.equal(mirata.errore, null);
});

test('il freno ferma la lettura a gruppi per nome di tutti i documenti, presi i nomi', async () => {
  const nomi = Array.from({ length: 30 }, (_, i) => `projects/p/databases/(default)/documents/feedback/f${i}`);
  // La rete finta dà i nomi alla query che li chiede, e niente al resto.
  const risponde = (input, init) => {
    const corpo = init && typeof init.body === 'string' ? JSON.parse(init.body) : {};
    return corpo.structuredQuery ? nomi.map((name) => ({ document: { name, fields: {} } })) : [];
  };
  const strumento = (maschera, aPezzi) => `export const tutti = async () => {
    const r = await fetch("${BASE}:runQuery?key=k", { method: "POST", body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: "feedback" }], select: { fields: [{ fieldPath: "__name__" }] } } }) });
    const nomi = (await r.json()).map((x) => x.document.name);
    for (let i = 0; i < nomi.length; i += ${aPezzi ? 10 : 1000}) {
      await fetch("${BASE}:batchGet?key=k", { method: "POST", body: JSON.stringify({ documents: nomi.slice(i, i + ${aPezzi ? 10 : 1000}) ${maschera} }) });
    }
  };`;
  for (const aPezzi of [false, true]) {
    const senza = await sottoIlFreno(async () => (await modulo(strumento('', aPezzi))).tutti(), risponde);
    assert.ok(senza.errore instanceof ScansioneSenzaCampi, `${aPezzi ? 'a pezzi da dieci' : 'tutti insieme'}: passa`);
    assert.equal(senza.arrivate.length, aPezzi ? 2 : 1, 'documenti interi oltre i dieci sono arrivati alla rete');
    const con = await sottoIlFreno(async () => (await modulo(strumento(', mask: { fieldPaths: ["seq"] }', aPezzi))).tutti(), risponde);
    assert.equal(con.errore, null, con.errore && con.errore.message);
    assert.equal(con.arrivate.length, aPezzi ? 4 : 2);
  }
});

test('il freno ferma anche la lettura uno per uno di tutti i documenti, presi i nomi; rileggerne uno non conta', async () => {
  const nomi = Array.from({ length: 20 }, (_, i) => `feedback/f${i}`);
  const strumento = (maschera) => `export const tutti = async () => {
    for (const n of ${JSON.stringify(nomi)}) await fetch(\`${BASE}/\${n}?key=k${maschera}\`);
  };`;
  const senza = await sottoIlFreno(async () => (await modulo(strumento(''))).tutti());
  assert.ok(senza.errore instanceof ScansioneSenzaCampi, `uno per uno senza campi passa: ${senza.errore && senza.errore.message}`);
  assert.equal(senza.arrivate.length, DOCUMENTI_SENZA_CAMPI_MAX, 'documenti interi oltre i dieci sono arrivati alla rete');
  const con = await sottoIlFreno(async () => (await modulo(strumento('&mask.fieldPaths=seq'))).tutti());
  assert.equal(con.errore, null, con.errore && con.errore.message);
  assert.equal(con.arrivate.length, 20);
  // Il contatore e la configurazione si rileggono quanto serve: è sempre lo stesso documento.
  const stesso = await sottoIlFreno(async () => { for (let i = 0; i < 30; i += 1) await fetch(`${BASE}/counters/feedbackSeq?key=k`); });
  assert.equal(stesso.errore, null, stesso.errore && stesso.errore.message);
  assert.equal(stesso.arrivate.length, 30);
});

test('il freno si installa per chiunque carichi il modulo delle segnalazioni, comunque lo nomini', () => {
  // Processi a parte, senza importare il freno: lo strumento carica solo il modulo, e scansiona le schede pubbliche.
  const prova = `process.stdout.write(String(Boolean(globalThis.fetch[Symbol.for('filo.frenoLetture')])));
    try { await globalThis.SN_FEEDBACK.listAllPublicPaged({}); process.stdout.write(' passata'); }
    catch (e) { process.stdout.write(' ' + (e && e.code)); }`;
  const fb = join(ROOT, 'src', 'shared', 'feedback');
  const modi = {
    'senza estensione': `const { createRequire } = await import('node:module'); createRequire(import.meta.url)(${JSON.stringify(fb)});`,
    'con l\'estensione, da import': `await import(${JSON.stringify(pathToFileURL(`${fb}.js`).href)});`,
  };
  for (const [come, carica] of Object.entries(modi)) {
    const esito = execFileSync(process.execPath, ['--input-type=module', '-e', `${carica}\n${prova}`], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(esito, 'true FILO_SCANSIONE_SENZA_CAMPI', `${come}: ${esito}`);
  }
});

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

test('ogni script che parla a Firestore da sé carica il freno prima di farlo', () => {
  // La collezione privata si legge solo con le credenziali di firestore-auth, che il freno lo porta con sé, e chi carica
  // il modulo dei feedback lo riceve dal modulo (prova qui sopra). Resta chi scrive l'indirizzo a mano: importa il
  // freno in testa, non dentro un ramo.
  const importaFreno = /^\s*import\s+(?:[^;]*?\sfrom\s+)?['"][^'"]*(?:freno-letture|firestore-auth)\.mjs['"]/m;
  const parlaConFirestore = /firestore\.googleapis/;
  const visti = scriptDiManutenzione();
  assert.ok(visti.some((f) => f.nome === 'lib/firestore-auth.mjs'), `lib/ non guardata: ${visti.map((f) => f.nome).join(', ')}`);
  const scoperti = visti.filter((f) => parlaConFirestore.test(f.testo) && !importaFreno.test(f.testo)).map((f) => f.nome);
  assert.deepEqual(scoperti, [], `questi script leggono Firestore senza il freno sulle scansioni: ${scoperti.join(', ')}`);
});

test('ogni script di manutenzione stampa quanti documenti ha letto', () => {
  // Chi lancia lo script deve vedere il costo sullo schermo, non in fattura.
  const MANUTENZIONE = ['auto-archive.mjs', 'backfill-feedback-numbers.mjs', 'conta-documenti.mjs'];
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
  const vere = { list: FB.list, listPublic: FB.listPublic, fetch: globalThis.fetch };
  FB.list = async (o) => { chieste.righe = o.fields; return o.afterName ? [] : righe.map((r) => ({ ...r })); };
  FB.listPublic = async (o) => { chieste.schede = o.fields; return o.afterName ? [] : schede.map((c) => ({ ...c })); };
  // I due conteggi che decidono il filtro sulle chiuse: qui il server non sa contare, e si leggono tutte.
  globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({}), text: async () => '' });
  const avviso = console.warn;
  console.warn = () => {};
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
    globalThis.fetch = vere.fetch;
    console.warn = avviso;
    FB.forgetAllPublic();
  }
});
