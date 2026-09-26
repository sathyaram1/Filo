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
    chiamata: /\bFB\.(?:listAllPaged|listAllPublic|listPublic|list)\s*\(/,
    campi: /fields\s*:/,
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
