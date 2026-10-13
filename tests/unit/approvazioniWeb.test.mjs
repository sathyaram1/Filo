// La pagina delle approvazioni da browser (#489): copie dei pezzi dell'app allineate, intestazioni che vietano
// d'incorniciarla, indirizzo del server scritto nella pagina e non preso da fuori, frasi d'errore per l'owner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const build = await import(pathToFileURL(join(ROOT, 'scripts', 'build-approvazioni.mjs')).href);
const { PAGINA_APPROVAZIONI } = await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'owner-merge.mjs')).href);
const fb = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
const CARTELLA = join(ROOT, build.CARTELLA);
const SORGENTE = readFileSync(join(CARTELLA, 'approvazioni.js'), 'utf8');
const HTML = readFileSync(join(CARTELLA, 'index.html'), 'utf8');

const ctx = {};
vm.runInNewContext(SORGENTE, ctx);
const W = ctx.SN_APPROVAZIONI_WEB;

test('le card, le icone e il tema della pagina sono le copie esatte di quelli dell\'app', () => {
  const vecchie = build.copieVecchie();
  assert.deepEqual(vecchie.map((v) => v.a), [], 'rigenera con: node scripts/build-approvazioni.mjs');
  assert.equal(build.main(['--controlla'], { log: () => {}, err: () => {} }), 0);
});

test('il predeploy rifiuta una copia vecchia, e la ricopia la rimette in pari', () => {
  const radice = cartellaTemporanea('filo-approvazioni-');
  try {
    for (const [da] of build.COPIE) {
      mkdirSync(dirname(join(radice, da)), { recursive: true });
      writeFileSync(join(radice, da), `/* ${da} */\n`);
    }
    const errori = [];
    assert.equal(build.main(['--controlla'], { log: () => {}, err: (m) => errori.push(m), radice }), 3);
    assert.match(errori.join('\n'), /node scripts\/build-approvazioni\.mjs/);
    assert.equal(build.main([], { log: () => {}, err: () => {}, radice }), 0);
    assert.equal(build.main(['--controlla'], { log: () => {}, err: () => {}, radice }), 0);
    writeFileSync(join(radice, build.COPIE[0][0]), '/* cambiata */\n');
    assert.equal(build.main(['--controlla'], { log: () => {}, err: () => {}, radice }), 3);
  } finally {
    togliCartella(radice);
  }
});

test('firebase.json pubblica la cartella della pagina, dopo la guardia e il controllo delle copie', () => {
  assert.equal(fb.hosting.public, build.CARTELLA);
  assert.deepEqual(fb.hosting.predeploy, ['node scripts/regole-pubblica.mjs --controlla', 'node scripts/build-approvazioni.mjs --controlla']);
});

test('le intestazioni vietano di incorniciarla e la CSP non apre a script in linea', () => {
  const h = Object.fromEntries(fb.hosting.headers.filter((x) => x.source === '**').flatMap((x) => x.headers.map((y) => [y.key, y.value])));
  assert.equal(h['X-Frame-Options'], 'DENY');
  const csp = h['Content-Security-Policy'];
  assert.match(csp, /frame-ancestors 'none'/);
  const script = (csp.match(/script-src ([^;]+)/) || [])[1] || '';
  assert.doesNotMatch(script, /unsafe-inline|unsafe-eval|\*/);
  const connect = (csp.match(/connect-src ([^;]+)/) || [])[1] || '';
  assert.ok(connect.split(/\s+/).includes(new URL(W.FUNZIONE).origin), 'la CSP deve lasciar parlare la pagina col server');
  assert.equal(h['Referrer-Policy'], 'no-referrer');
});

test('ogni file che la pagina carica esiste, e l\'SDK di Google è una versione sola', () => {
  const rif = [...HTML.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('data:'));
  const sdk = rif.filter((u) => u.startsWith('/__/firebase/'));
  assert.equal(sdk.length, 2);
  assert.equal(new Set(sdk.map((u) => u.split('/')[3])).size, 1);
  for (const u of rif.filter((x) => !x.startsWith('/__/'))) assert.ok(existsSync(join(CARTELLA, u)), `manca ${u}`);
  for (const [, a] of build.COPIE) assert.ok(rif.includes(a), `la pagina non carica ${a}`);
  assert.ok(rif.indexOf('filo/mergeApprovals.js') < rif.indexOf('approvazioni.js'));
});

test('l\'indirizzo del server e quello della pagina non si prendono da fuori', () => {
  assert.equal(W.FUNZIONE, 'https://europe-west1-filo-8b9cb.cloudfunctions.net/ownerMergeApprovals');
  assert.doesNotMatch(SORGENTE, /location\.(search|hash)|URLSearchParams|addEventListener\(\s*['"]message/);
  assert.ok(W.fraseAccesso('auth/unauthorized-domain').includes(PAGINA_APPROVAZIONI), 'il terminale e la pagina devono nominare lo stesso indirizzo');
});

test('le credenziali restano in memoria e la scelta dell\'account si vede sempre', () => {
  assert.match(SORGENTE, /setPersistence\(fb\.auth\.Auth\.Persistence\.NONE\)/);
  assert.match(SORGENTE, /prompt: 'select_account'/);
});

test('un errore del server diventa una frase con la mossa da fare', () => {
  assert.match(W.fraseErrore({ rete: true }), /non risponde/);
  assert.match(W.fraseErrore({ http: 403, codice: 'PERMISSION_DENIED', dettaglio: 'Riservato al proprietario.' }), /non è quello del proprietario/);
  assert.match(W.fraseErrore({ http: 401, codice: 'UNAUTHENTICATED' }), /rifai l’accesso/);
  assert.match(W.fraseErrore({ http: 404 }), /rideployate/);
  assert.equal(W.fraseErrore({ http: 400, codice: 'FAILED_PRECONDITION', dettaglio: 'questa richiesta è scaduta: rilancia i controlli e rifalla' }),
    'questa richiesta è scaduta: rilancia i controlli e rifalla');
  assert.match(W.fraseErrore({ http: 500 }), /errore 500/);
  assert.equal(W.fraseErrore(null), 'Non riuscito.');
});

test('l\'accesso chiuso dall\'owner non è un errore; gli altri si spiegano', () => {
  assert.equal(W.fraseAccesso('auth/popup-closed-by-user'), '');
  assert.equal(W.fraseAccesso('auth/cancelled-popup-request'), '');
  assert.match(W.fraseAccesso('auth/popup-blocked'), /bloccato la finestra/);
  assert.match(W.fraseAccesso('auth/network-request-failed'), /connessione/);
  assert.match(W.fraseAccesso('auth/qualcosa'), /\(auth\/qualcosa\)/);
});

test('l\'impronta cambia quando cambia qualcosa da decidere, non quando passa il tempo', () => {
  const r = { id: 'a', sha: 's', used: false, expiresAtMs: 5 };
  const uno = W.impronta({ pending: [r], failed: [], recent: [] });
  assert.equal(W.impronta({ pending: [{ ...r, createdAtMs: 99 }], failed: [], recent: [] }), uno);
  assert.notEqual(W.impronta({ pending: [{ ...r, used: true }] }), uno);
  assert.notEqual(W.impronta({ pending: [], failed: [], recent: [r] }), uno);
  assert.equal(W.impronta(null), W.impronta({}));
});

test('la risposta del server arriva alle card nella forma dell\'app', () => {
  // La pagina gira in un altro contesto: si confrontano i dati, non i prototipi.
  const dati = (v) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(dati(W.rispostaPerCard({ ok: false, reason: 'github_no_token', detail: '' })), { ok: false, error: 'github_no_token' });
  assert.deepEqual(dati(W.rispostaPerCard({ ok: true, result: 'merged', sha: 'x' })), { ok: true, result: 'merged', sha: 'x' });
  assert.equal(W.rispostaPerCard(null).ok, false);
});
