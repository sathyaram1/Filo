// Sentinella: una scansione della collezione chiede i CAMPI che usa.
//
// Perché conta. Un feedback pesa qualche KB — testo cifrato, note, allegati — e
// gli script di manutenzione ne guardano tre o quattro campi. Lanciati qualche
// volta nello stesso pomeriggio (prova a secco, applicazione, controllo) su una
// collezione intera fanno una raffica: a settembre 2026 un solo giorno ha fatto
// il 40% del conto mensile di Firestore (#680).
//
// La proiezione non si può rendere obbligatoria nella porta comune senza
// spezzare le pagine dell'app, che la lettura intera la vogliono davvero.
// Quindi la regola vive qui: chi scrive il prossimo script di manutenzione se ne
// accorge in millisecondi invece che in fattura.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

// Le tre forme con cui uno script chiede una collezione, e come si dice «solo
// questi campi» in ognuna.
const FORME = [
  {
    nome: 'le liste dei feedback (SN_FEEDBACK)',
    // Ogni `list…` del modulo, non un elenco di nomi: con l'elenco, `listAll`
    // e `listAllPublicPaged` — le due scorciatoie per «dammi tutto» — passavano
    // davanti al freno senza una parola (#680, primo giro).
    chiamata: /\b(?:FB|SN_FEEDBACK)\.list[A-Za-z]*\s*\(/,
    campi: /fields\s*:/,
    perChiamata: true,
    rimedio: 'passa `fields: [...]` (es. SN_BOARD_ARCHIVE.CAMPI_DECISIONE)',
  },
  {
    nome: 'una structuredQuery scritta a mano',
    chiamata: /structuredQuery\s*[=.]/,
    campi: /\.select\s*=|select\s*:/,
    rimedio: 'aggiungi `select: { fields: [...] }` alla structuredQuery',
  },
  {
    nome: 'la lista REST dei documenti',
    chiamata: /\/feedback\?pageSize|\/feedback\?\$\{/,
    campi: /mask\.fieldPaths/,
    rimedio: 'aggiungi `mask.fieldPaths=<campo>` alla query string',
  },
];

// Gli argomenti di UNA chiamata, dalla parentesi aperta alla sua: la regola è
// per chiamata, non per file. Un file che altrove passa i campi non assolve la
// scansione che li ha dimenticati.
function argomentiDellaChiamata(testo, da) {
  let profondita = 0;
  for (let i = da; i < testo.length; i += 1) {
    const c = testo[i];
    if (c === '(') profondita += 1;
    else if (c === ')') { profondita -= 1; if (profondita === 0) return testo.slice(da, i + 1); }
  }
  return testo.slice(da);
}

function scriptDiManutenzione() {
  const out = [];
  for (const nome of readdirSync(SCRIPTS)) {
    if (!nome.endsWith('.mjs')) continue;
    out.push({ nome, testo: readFileSync(join(SCRIPTS, nome), 'utf8') });
  }
  return out;
}

test('nessuno script scansiona la collezione dei feedback senza dire quali campi gli servono', () => {
  const colpevoli = [];
  for (const { nome, testo } of scriptDiManutenzione()) {
    for (const forma of FORME) {
      if (forma.perChiamata) {
        for (const m of testo.matchAll(new RegExp(forma.chiamata, 'g'))) {
          const args = argomentiDellaChiamata(testo, m.index + m[0].length - 1);
          if (forma.campi.test(args)) continue;
          colpevoli.push(`scripts/${nome} — ${m[0].trim()} ${forma.nome}: ${forma.rimedio}`);
        }
        continue;
      }
      if (!forma.chiamata.test(testo)) continue;
      if (forma.campi.test(testo)) continue;
      colpevoli.push(`scripts/${nome} — ${forma.nome}: ${forma.rimedio}`);
    }
  }
  assert.deepEqual(colpevoli, [],
    `questi script scaricano documenti interi per guardarne qualche campo:\n  ${colpevoli.join('\n  ')}`);
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
