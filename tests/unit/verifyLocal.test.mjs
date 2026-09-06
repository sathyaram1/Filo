// Unit test del cancello di verifica locale.
//
// PERCHÉ CONTA
//   È l'unica cosa che impedisce a chi ha scritto il codice di pubblicarlo senza
//   che nessun altro l'abbia provato. Se questa logica sbaglia in senso
//   permissivo, il cancello c'è ma non chiude — che è peggio di non averlo,
//   perché dà l'impressione che qualcuno abbia controllato.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const {
  checkVerdict, withRequest, withVerdict, withCritique, withFixed, buildVerifierBrief, phase2Text, historyFromRounds,
  realignPlan, afterRebase,
} = await import('../../scripts/verify-local.mjs');

const SHA = 'a'.repeat(40);
const ALTRO_SHA = 'b'.repeat(40);

test('checkVerdict: senza verifica non si pubblica', () => {
  assert.equal(checkVerdict(undefined, SHA).ok, false);
  assert.equal(checkVerdict(null, SHA).ok, false);
  // Verifica avviata ma mai conclusa: vale come non fatta.
  assert.equal(checkVerdict({ request: 'fai X', requestedSha: SHA }, SHA).ok, false);
  // Correzione in sospeso, o consegnata senza un'altra verifica: non si pubblica.
  assert.equal(checkVerdict({ verdict: 'fix-pending', sha: SHA }, SHA).ok, false);
  assert.equal(checkVerdict({ verdict: 'fixed', sha: SHA }, SHA).ok, false);
});

test('checkVerdict: una bocciatura blocca, e dice perché', () => {
  const r = checkVerdict({ verdict: 'fail', critique: 'il pulsante non salva', sha: SHA }, SHA);
  assert.equal(r.ok, false);
  assert.match(r.reason, /il pulsante non salva/);
});

test('checkVerdict: approvato sullo STESSO contenuto → si pubblica', () => {
  assert.equal(checkVerdict({ verdict: 'pass', sha: SHA }, SHA).ok, true);
});

// Il buco che questo cancello deve chiudere: farsi approvare una versione e
// pubblicarne un'altra. Senza il confronto sul contenuto, questo test passa
// anche col codice cambiato dopo il PASS.
test('checkVerdict: se il codice cambia dopo il PASS, l’esito decade', () => {
  const r = checkVerdict({ verdict: 'pass', sha: SHA }, ALTRO_SHA);
  assert.equal(r.ok, false);
  assert.match(r.reason, /cambiato dopo la verifica/);
  // E un verdetto senza contenuto associato non vale come approvazione.
  assert.equal(checkVerdict({ verdict: 'pass', sha: '' }, SHA).ok, false);
  assert.equal(checkVerdict({ verdict: 'pass', sha: SHA }, '').ok, false);
});

// Il secondo modo di farsi approvare una versione e pubblicarne un'altra: non
// serve nemmeno un commit nuovo, bastano modifiche non ancora salvate — e il
// confronto sul commit non le vede. Capitato davvero, su questo stesso lavoro.
test('checkVerdict: modifiche non salvate invalidano l’approvazione', () => {
  assert.equal(checkVerdict({ verdict: 'pass', sha: SHA }, SHA, false).ok, true);
  const sporco = checkVerdict({ verdict: 'pass', sha: SHA }, SHA, true);
  assert.equal(sporco.ok, false);
  assert.match(sporco.reason, /modifiche non salvate/);
});

test('withRequest / withVerdict: lo stato è per ramo e non si calpesta', () => {
  let s = withRequest({}, 'claude/uno', { request: 'fai X', sha: SHA, at: 't0' });
  s = withRequest(s, 'claude/due', { request: 'fai Y', sha: ALTRO_SHA, at: 't0' });
  s = withVerdict(s, 'claude/uno', { verdict: 'pass', critique: 'ok', sha: SHA, at: 't1' });

  assert.equal(s['claude/uno'].verdict, 'pass');
  assert.equal(s['claude/uno'].request, 'fai X');   // la richiesta non si perde
  assert.equal(s['claude/due'].verdict, undefined); // l'altro ramo resta com'era
  assert.equal(checkVerdict(s['claude/due'], ALTRO_SHA).ok, false);
});

test('withVerdict: qualunque cosa diversa da "pass" è una bocciatura', () => {
  const s = withVerdict({}, 'r', { verdict: 'boh', sha: SHA });
  assert.equal(s.r.verdict, 'fail');
  assert.equal(checkVerdict(s.r, SHA).ok, false);
});

// ─── Il verificatore che corregge, in locale (feedback #561) ─────────────────
//
// Stessa struttura del giro in cloud: critica coi livelli → l'esito lo
// calcolano le regole condivise → se c'è da correggere, la fase 2 (stampata
// SOLO adesso) → consegna → un'altra verifica.

test('critica senza rilievi: verifica superata sul contenuto', () => {
  const r = withCritique(withRequest({}, 'r', { request: 'fai X', sha: SHA }), 'r', { critique: 'Provato tutto, regge.', sha: SHA });
  assert.equal(r.outcome, 'pass');
  assert.equal(checkVerdict(r.state.r, SHA).ok, true);
});

test('critica con un 2: finché il giro non è chiuso non si pubblica, e dopo serve un\'altra verifica', () => {
  let s = withRequest({}, 'r', { request: 'fai X', sha: SHA });
  const r = withCritique(s, 'r', { critique: 'funziona Y\n[2] il pulsante non salva\n[0] caso raro', sha: SHA });
  assert.equal(r.outcome, 'fix');
  assert.deepEqual(r.decision.fix.map((f) => f.level), [2, 0], 'gli 0 si correggono insieme ad altro');
  assert.equal(r.state.r.verdict, 'fix-pending');
  assert.equal(r.state.r.counts.count2, 1, 'il giro si paga da cap2');
  const bloccato = checkVerdict(r.state.r, SHA);
  assert.equal(bloccato.ok, false);
  assert.match(bloccato.reason, /giro di correzione aperto/);
  // La fase 2 si vede solo adesso, e dice cosa correggere e come consegnare.
  const testo = phase2Text({ findings: r.decision.fix, derived: r.decision.derived, budgets: r.decision.budgets, branch: 'r' });
  assert.match(testo, /\[2\] il pulsante non salva/);
  assert.match(testo, /verify-local\.mjs corretto/);
  // Consegna: chiude la fase 2, ma NON approva: serve un'altra verifica.
  const c = withFixed(r.state, 'r', { report: 'corretto', sha: ALTRO_SHA });
  assert.equal(c.ok, true);
  assert.equal(c.state.r.verdict, 'fixed');
  const dopo = checkVerdict(c.state.r, ALTRO_SHA);
  assert.equal(dopo.ok, false);
  assert.match(dopo.reason, /un'altra verifica/);
  // La richiesta e i bilanci sopravvivono al nuovo `start`.
  s = withRequest(c.state, 'r', { request: 'fai X', sha: ALTRO_SHA });
  assert.equal(s.r.counts.count2, 1, 'i bilanci sono del lavoro, non della singola verifica');
  assert.equal(s.r.verdict, undefined, 'la verifica nuova parte senza esito');
});

test('withFixed senza un giro aperto: rifiutata', () => {
  const s = withRequest({}, 'r', { request: 'fai X', sha: SHA });
  assert.equal(withFixed(s, 'r', { report: 'x', sha: SHA }).ok, false);
});

test('un 2 a bilancio esaurito, o col segno ?: esito stop', () => {
  let s = withRequest({}, 'r', { request: 'fai X', sha: SHA });
  s.r.counts = { count2: 5 };
  const r = withCritique(s, 'r', { critique: '[2] ancora rotto', sha: SHA });
  assert.equal(r.outcome, 'stop');
  assert.equal(r.state.r.verdict, 'fail');
  assert.match(checkVerdict(r.state.r, SHA).reason, /bocciato/);
  const d = withCritique(withRequest({}, 'r', { request: 'fai X', sha: SHA }), 'r', { critique: '[2?] quale strada?', sha: SHA });
  assert.equal(d.outcome, 'stop');
});

test('i rilievi fuori dal giro restano in `derived` per il report', () => {
  const r = withCritique(withRequest({}, 'r', { request: 'fai X', sha: SHA }), 'r', { critique: '[0] caso raro', sha: SHA });
  assert.equal(r.outcome, 'pass');
  assert.equal(r.state.r.derived.length, 1);
  assert.equal(checkVerdict(r.state.r, SHA).ok, true, 'uno 0 da solo non ferma la pubblicazione');
});

test('buildVerifierBrief: niente che non serva a criticare', () => {
  const brief = buildVerifierBrief({ request: 'x', branch: 'r', recipe: 'RECIPE' });
  assert.match(brief, /verify-local\.mjs critica/);
  assert.ok(!/corretto "/.test(brief), 'il comando della correzione non si annuncia prima');
  assert.ok(!/FASE 2/.test(brief));
});

// L'isolamento è il motivo per cui questa verifica vale qualcosa: se al
// verificatore arriva il diff, sta rileggendo il lavoro di un altro invece di
// provare la cosa chiesta.
test('buildVerifierBrief: consegna la richiesta e il ramo, e vieta il diff', () => {
  const brief = buildVerifierBrief({
    request: 'voglio poter rimuovere le immagini allegate',
    branch: 'claude/immagini',
    recipe: 'RECIPE-QUI',
  });
  assert.match(brief, /voglio poter rimuovere le immagini allegate/);
  assert.match(brief, /claude\/immagini/);
  assert.match(brief, /RECIPE-QUI/);
  // Il divieto è esplicito, non implicito.
  assert.match(brief, /niente diff/i);
  assert.match(brief, /niente report/i);
});

// ─── Riallineamento alla linea principale (caso #500) ────────────────────────
//
// Un ramo che resta indietro mentre aspetta i controlli o l'approvazione
// finisce in conflitto di fusione, scoperto solo alla fine. La decisione
// (behind/pulito/sporco/conflitto → cosa fare) è pura; qui la si inchioda.

test('realignPlan: ramo indietro e pulito → rebase', () => {
  assert.deepEqual(realignPlan({ fetchOk: true, dirty: false, behind: 5 }), { action: 'rebase', message: '' });
});

test('realignPlan: ramo pari, o solo avanti → niente da fare, in silenzio', () => {
  assert.deepEqual(realignPlan({ fetchOk: true, dirty: false, behind: 0 }), { action: 'skip', message: '' });
  assert.deepEqual(realignPlan({ fetchOk: true, dirty: false, behind: -1 }), { action: 'skip', message: '' });
  // Conteggio illeggibile: non si rebasa alla cieca.
  assert.equal(realignPlan({ fetchOk: true, dirty: false, behind: NaN }).action, 'skip');
});

test('realignPlan: modifiche non salvate → niente rebase, ma DETTO', () => {
  const r = realignPlan({ fetchOk: true, dirty: true, behind: 2 });
  assert.equal(r.action, 'skip');
  assert.match(r.message, /non salvate/, 'un salto silenzioso è indistinguibile dal non avere il riallineamento');
});

test('realignPlan: fetch fallito (rete assente) → niente rebase, ma DETTO', () => {
  const r = realignPlan({ fetchOk: false, dirty: false, behind: 0 });
  assert.equal(r.action, 'skip');
  assert.ok(r.message.length > 0, 'la rete assente si dichiara, non si inghiotte');
});

test('realignPlan: su un ramo protetto nessun automatismo scrive', () => {
  assert.deepEqual(realignPlan({ fetchOk: true, dirty: false, behind: 3, workBranch: false }),
    { action: 'skip', message: '' });
});

test('afterRebase pulito → push, con un messaggio che dice cos\'è successo', () => {
  const r = afterRebase({ ok: true, behind: 4 });
  assert.equal(r.action, 'push');
  assert.match(r.message, /4 commit/);
  assert.match(r.message, /riallineato/);
});

test('afterRebase in conflitto → abort, coi file elencati e il rimedio', () => {
  const r = afterRebase({ ok: false, conflictFiles: ['src/a.js', 'src/b.js'] });
  assert.equal(r.action, 'abort');
  assert.match(r.message, /src\/a\.js/);
  assert.match(r.message, /src\/b\.js/);
  assert.match(r.message, /com'era/, 'deve dire che il ramo è rimasto intatto');
  assert.match(r.message, /rilancia/, 'deve dire cosa fare adesso');
});

test('afterRebase in conflitto senza elenco file: messaggio comunque utilizzabile', () => {
  const r = afterRebase({ ok: false, conflictFiles: null });
  assert.equal(r.action, 'abort');
  assert.ok(r.message.length > 0);
});

// ─── Il riallineamento ESEGUITO: `start` su un repo usa-e-getta ──────────────
//
// Le funzioni pure decidono; qui si controlla che `start` le esegua davvero:
// rebase quando è pulito (e il ramo rispedito su origin), abort quando è in
// conflitto (e il ramo ESATTAMENTE com'era, niente rebase a metà).

const VERIFY = fileURLToPath(new URL('../../scripts/verify-local.mjs', import.meta.url));
const sandbox = [];
test.after(() => {
  for (const d of sandbox) { try { rmSync(d, { recursive: true, force: true }); } catch (_) {} }
});

function g(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * origin (bare) + due cloni: `work` col ramo di lavoro, `altro` che fa
 * avanzare main su origin alle spalle di work. `conflitto` decide se i due
 * toccano lo stesso file.
 */
function scenario({ conflitto }) {
  const base = mkdtempSync(resolve(tmpdir(), 'filo-verify-'));
  sandbox.push(base);
  const origin = resolve(base, 'origin.git');
  const work = resolve(base, 'work');
  const altro = resolve(base, 'altro');
  mkdirSync(origin);
  mkdirSync(work);
  g(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  // L'identità va nel config del repo (non inline sul commit): il rebase la
  // farà servire anche al CLI sotto test, che non può passarla lui.
  const identita = (dir) => {
    g(dir, ['config', 'user.email', 't@t']);
    g(dir, ['config', 'user.name', 't']);
  };
  const commit = (dir, file, contenuto, msg) => {
    writeFileSync(resolve(dir, file), contenuto, 'utf8');
    g(dir, ['add', '-A']);
    g(dir, ['commit', '-q', '-m', msg]);
  };
  g(work, ['init', '-q', '--initial-branch=main']);
  g(work, ['remote', 'add', 'origin', origin]);
  identita(work);
  commit(work, 'comune.txt', 'base\n', 'base');
  g(work, ['push', '-q', 'origin', 'refs/heads/main:refs/heads/main']);

  // Il ramo di lavoro nasce da main e fa il suo commit…
  g(work, ['checkout', '-q', '-b', 'claude/prova']);
  commit(work, conflitto ? 'comune.txt' : 'lavoro.txt', 'mio\n', 'lavoro');
  g(work, ['push', '-q', 'origin', 'refs/heads/claude/prova:refs/heads/claude/prova']);

  // …mentre main su origin va avanti alle sue spalle.
  execFileSync('git', ['clone', '-q', origin, altro], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  identita(altro);
  commit(altro, conflitto ? 'comune.txt' : 'principale.txt', 'loro\n', 'avanzamento');
  g(altro, ['push', '-q', 'origin', 'refs/heads/main:refs/heads/main']);

  return { origin, work };
}

function lanciaStart(work) {
  return spawnSync(process.execPath, [VERIFY, 'start', 'richiesta di prova'], {
    env: { ...process.env, FILO_REPO_ROOT: work },
    encoding: 'utf8',
  });
}

test('start su un ramo rimasto indietro: riallinea e rispedisce (senza il fix resta indietro)', () => {
  const { origin, work } = scenario({ conflitto: false });
  const r = lanciaStart(work);
  assert.equal(r.status, 0, `start deve riuscire: ${r.stderr}`);
  assert.match(String(r.stdout), /riallineato/, 'il riallineamento va dichiarato, non fatto in silenzio');
  // Dopo: il ramo contiene l'avanzamento di main (behind = 0)…
  assert.equal(g(work, ['rev-list', '--count', 'HEAD..origin/main']), '0', 'il ramo non deve più essere indietro');
  // …il lavoro proprio non è andato perso…
  assert.ok(existsSync(resolve(work, 'lavoro.txt')), 'il commit del ramo sopravvive al riallineamento');
  // …e origin ha la versione riallineata: è quella che il server fonderebbe.
  assert.equal(g(origin, ['rev-parse', 'refs/heads/claude/prova']), g(work, ['rev-parse', 'HEAD']),
    'il ramo riallineato va rispedito, o il server guarderebbe la versione vecchia');
});

test('start col riallineamento in conflitto: abort, ramo intatto, niente rebase a metà', () => {
  const { work } = scenario({ conflitto: true });
  const prima = g(work, ['rev-parse', 'HEAD']);
  const r = lanciaStart(work);
  assert.equal(r.status, 1, 'sul conflitto la verifica non deve partire');
  assert.match(String(r.stderr), /conflitto/);
  assert.match(String(r.stderr), /comune\.txt/, 'il file in conflitto va nominato');
  assert.equal(g(work, ['rev-parse', 'HEAD']), prima, 'il ramo deve restare ESATTAMENTE com\'era');
  assert.equal(g(work, ['status', '--porcelain']), '', 'niente repo lasciato a metà rebase');
  assert.ok(!existsSync(resolve(work, '.git', 'rebase-merge')) && !existsSync(resolve(work, '.git', 'rebase-apply')),
    'nessun rebase in corso dopo l\'abort');
});

// ── Verifica del 2026-09-05 su #561: le porte trovate dal verificatore ──────
// (i rilievi registrati con `verify-local.mjs critica`, corretti nello stesso giro)

test('#561 verifica: una critica vuota non è un pass', () => {
  const s = withRequest({}, 'r', { request: 'fai X', sha: SHA });
  const r = withCritique(s, 'r', { critique: '   ', sha: SHA });
  assert.equal(r.ok, false);
  assert.equal(checkVerdict(r.state.r, SHA).ok, false, 'niente pass registrato');
});

test('#561 verifica: una seconda critica sullo stesso giro è rifiutata e non paga un altro giro', () => {
  const s = withRequest({}, 'r', { request: 'fai X', sha: SHA });
  const uno = withCritique(s, 'r', { critique: '[2] rotto', sha: SHA });
  const due = withCritique(uno.state, 'r', { critique: '[2] rotto ancora', sha: SHA });
  assert.equal(due.ok, false);
  assert.equal(due.state.r.counts.count2, 1, 'un giro solo');
  assert.equal(due.state.r.verdict, 'fix-pending');
  assert.match(due.state.r.pending.findings[0].text, /^rotto$/, 'la critica registrata è ancora quella');
});

test('#561 verifica: il giro dopo vede il TESTO della critica precedente, mai il report di chi ha lavorato', () => {
  const s = withRequest({}, 'r', { request: 'fai X', sha: SHA });
  const r = withCritique(s, 'r', { critique: 'ok\n[2] il pulsante non salva col titolo vuoto', sha: SHA });
  const c = withFixed(r.state, 'r', { report: 'REPORT SEGRETO del correttore', sha: ALTRO_SHA });
  assert.equal(c.outcome, 'fixed');
  const h = historyFromRounds(c.state.r.rounds);
  assert.equal(h.length, 1);
  assert.match(h[0].critique, /il pulsante non salva col titolo vuoto/);
  assert.ok(!/REPORT SEGRETO/.test(h[0].critique));
  const brief = buildVerifierBrief({ request: 'x', branch: 'r', recipe: 'R', history: h });
  assert.match(brief, /il pulsante non salva col titolo vuoto/);
  assert.ok(!/REPORT SEGRETO/.test(brief));
});

test('#561 verifica: «corretto» senza un commit nuovo non chiede un\'altra verifica', () => {
  // Con solo un 1 in sospeso: il lavoro passa e il rilievo va nel report.
  const uno = withCritique(withRequest({}, 'r', { request: 'fai X', sha: SHA }), 'r', { critique: '[1] bordo grigio', sha: SHA });
  const c1 = withFixed(uno.state, 'r', { report: 'non ci sono riuscito', sha: SHA });
  assert.equal(c1.ok, true);
  assert.equal(c1.outcome, 'pass');
  assert.equal(checkVerdict(c1.state.r, SHA).ok, true);
  assert.equal(c1.state.r.derived.length, 1);
  assert.equal(c1.state.r.rounds.at(-1).outcome, 'non corretto');
  // Con un 2 in sospeso: non correggibile, il lavoro si ferma.
  const due = withCritique(withRequest({}, 'r', { request: 'fai X', sha: SHA }), 'r', { critique: '[2] rotto', sha: SHA });
  const c2 = withFixed(due.state, 'r', { report: 'non ci sono riuscito', sha: SHA });
  assert.equal(c2.outcome, 'stop');
  assert.equal(c2.state.r.verdict, 'fail');
  assert.match(checkVerdict(c2.state.r, SHA).reason, /rotto/);
  // Con modifiche non salvate: rifiutata, la consegna vale per un commit.
  const c3 = withFixed(due.state, 'r', { report: 'x', sha: ALTRO_SHA, dirty: true });
  assert.equal(c3.ok, false);
});

// ── Verifica del giro 2 (2026-09-05) su #561 ─────────────────────────────────

test('#561 giro 2: chiuso un giro, la critica non si registra di nuovo: serve un nuovo start', () => {
  const s = withRequest({}, 'r', { request: 'fai X', sha: SHA });
  const r = withCritique(s, 'r', { critique: 'ok\n[1] bordo', sha: SHA });
  const c = withFixed(r.state, 'r', { report: 'corretto', sha: ALTRO_SHA });
  assert.equal(c.outcome, 'fixed');
  const auto = withCritique(c.state, 'r', { critique: 'Provato tutto: regge.', sha: ALTRO_SHA });
  assert.equal(auto.ok, false);
  assert.match(auto.reason, /start/);
  assert.equal(checkVerdict(auto.state.r, ALTRO_SHA).ok, false, 'niente pass: chi corregge non si approva da solo');
  // Dopo start, la critica di un'altra istanza passa.
  const di_nuovo = withCritique(withRequest(auto.state, 'r', { request: 'fai X', sha: ALTRO_SHA }), 'r', { critique: 'Provato tutto: regge.', sha: ALTRO_SHA });
  assert.equal(di_nuovo.ok, true);
  assert.equal(checkVerdict(di_nuovo.state.r, ALTRO_SHA).ok, true);
});

test('#561 giro 2: un livello scritto fuori posto non è un pass silenzioso; l\'elenco numerato vale', () => {
  const s = withRequest({}, 'r', { request: 'fai X', sha: SHA });
  const inline = withCritique(s, 'r', { critique: 'Provato. Rilievo [2]: il pulsante non salva.', sha: SHA });
  assert.equal(inline.ok, false);
  assert.match(inline.reason, /Rilievo \[2\]/);
  assert.equal(checkVerdict(inline.state.r, SHA).ok, false);
  const numerato = withCritique(s, 'r', { critique: 'Provato.\n1. [2] il pulsante non salva\n2. [1] bordo', sha: SHA });
  assert.equal(numerato.ok, true);
  assert.equal(numerato.outcome, 'fix');
  assert.deepEqual(numerato.decision.fix.map((f) => f.level), [2, 1]);
});

// ── Verifica del giro 3 (2026-09-05) su #561 ─────────────────────────────────

test('#561 giro 3: dopo un pass (o uno stop) una seconda critica senza un nuovo start è rifiutata', () => {
  const s = withRequest({}, 'r', { request: 'fai X', sha: SHA });
  const ok = withCritique(s, 'r', { critique: 'Regge tutto.', sha: SHA });
  assert.equal(ok.outcome, 'pass');
  const ripensa = withCritique(ok.state, 'r', { critique: 'Ripensandoci.\n[2] ora lo vedo', sha: SHA });
  assert.equal(ripensa.ok, false);
  assert.match(ripensa.reason, /start/);
  assert.equal(ripensa.state.r.verdict, 'pass', 'il pass registrato resta quello');
  assert.equal(ripensa.state.r.counts.count2 || 0, 0, 'nessun giro pagato');
  const fermo = withCritique(s, 'r', { critique: 'P.\n[2?] scelta', sha: SHA });
  assert.equal(fermo.outcome, 'stop');
  assert.equal(withCritique(fermo.state, 'r', { critique: 'Regge.', sha: SHA }).ok, false);
  // Dopo start la critica di un'altra istanza passa.
  const dopo = withCritique(withRequest(ok.state, 'r', { request: 'fai X', sha: ALTRO_SHA }), 'r', { critique: 'P.\n[2] ora lo vedo', sha: ALTRO_SHA });
  assert.equal(dopo.ok, true);
  assert.equal(dopo.outcome, 'fix');
});

test('#561 giro 3: quando il lavoro si ferma i bilanci si azzerano (come sul server), la storia resta', () => {
  let s = withRequest({}, 'r', { request: 'fai X', sha: SHA });
  for (let i = 0; i < 5; i++) {
    const r = withCritique(s, 'r', { critique: `P.\n[2] rotto ${i}`, sha: SHA });
    assert.equal(r.outcome, 'fix', `giro ${i}`);
    s = withRequest(withFixed(r.state, 'r', { report: 'ok', sha: ALTRO_SHA }).state, 'r', { request: 'fai X', sha: ALTRO_SHA });
  }
  const sesto = withCritique(s, 'r', { critique: 'P.\n[2] rotto 6', sha: ALTRO_SHA });
  assert.equal(sesto.outcome, 'stop');
  assert.deepEqual(sesto.state.r.counts, {});
  assert.equal(sesto.state.r.rounds.length, 6, 'la storia dei giri resta');
  // L'owner decide, il lavoro si rifà: il primo [2] si corregge, non ferma.
  const rifatto = withCritique(withRequest(sesto.state, 'r', { request: 'fai X', sha: SHA }), 'r', { critique: 'P.\n[2] rotto 7', sha: SHA });
  assert.equal(rifatto.outcome, 'fix');
  assert.equal(historyFromRounds(rifatto.state.r.rounds).length, 7);
  // Anche lo stop da «corretto» senza commit nuovo azzera.
  const c = withFixed(rifatto.state, 'r', { report: 'non ci riesco', sha: SHA });
  assert.equal(c.outcome, 'stop');
  assert.deepEqual(c.state.r.counts, {});
});

test('#561 giro 3: «[4] gravissimo» a inizio riga non è un pass silenzioso', () => {
  const s = withRequest({}, 'r', { request: 'fai X', sha: SHA });
  const r = withCritique(s, 'r', { critique: 'Provato.\n[4] gravissimo', sha: SHA });
  assert.equal(r.ok, false);
  assert.match(r.reason, /\[4\] gravissimo/);
  assert.equal(checkVerdict(r.state.r, SHA).ok, false);
});

test('#561 giro 4: «[2]» senza testo è respinto, non un pass; il riassunto può citare un livello in mezzo alla frase', () => {
  const s = withRequest({}, 'r', { request: 'x', sha: SHA });
  const vuoto = withCritique(s, 'r', { critique: 'Provato: regge quasi tutto.\n[2]', sha: SHA });
  assert.equal(vuoto.ok, false);
  assert.match(vuoto.reason, /rilievo senza testo/);
  const inMezzo = withCritique(s, 'r', { critique: 'Provato il caso [2?] del giro prima: chiuso, e testi di [10000] caratteri.', sha: SHA });
  assert.equal(inMezzo.ok, true);
  assert.equal(inMezzo.outcome, 'pass');
});

// ── Le scorciatoie dal CLI (#561 giro 7) ─────────────────────────────────────
//
// Un «pass» con dentro una riga di livello 2 vale il testo: lo stato diventa
// «sta correggendo» e la risposta deve dirlo, con la fase 2, come farebbe
// `critica`. Prima stampava «il lavoro torna a chi l'ha fatto» e la fase 2
// non usciva mai: start e critica respinti, e l'unica uscita era «corretto».
import { execFileSync as _exec } from 'node:child_process';
import { mkdtempSync as _mkdtemp, writeFileSync as _write } from 'node:fs';
import { tmpdir as _tmp } from 'node:os';
const _ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

function depositoUsaEGetta() {
  const casa = _mkdtemp(resolve(_tmp(), 'filo-vl-cli-'));
  const g = (...a) => _exec('git', a, { cwd: casa, encoding: 'utf8' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  _write(resolve(casa, '.gitignore'), '.claude/\n', 'utf8');
  _write(resolve(casa, 'a.txt'), 'x', 'utf8');
  g('add', '-A'); g('commit', '-qm', 'init'); g('checkout', '-q', '-b', 'claude/prova');
  return casa;
}
function vl(casa, ...args) {
  try {
    return { code: 0, out: _exec(process.execPath, [resolve(_ROOT, 'scripts', 'verify-local.mjs'), ...args], { cwd: casa, encoding: 'utf8', env: { ...process.env, FILO_REPO_ROOT: casa }, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) { return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; }
}

test('CLI: «pass» con dentro un [2] non è un pass: risponde che c\'è da correggere; «fail» ferma', () => {
  const casa = depositoUsaEGetta();
  assert.equal(vl(casa, 'start', 'richiesta').code, 0);
  const p = vl(casa, 'pass', 'Provato tutto.\n[2] però questo è rotto');
  assert.equal(p.code, 0, p.out);
  assert.match(p.out, /c'è da correggere[\s\S]*Rilievi da correggere ADESSO/);
  assert.match(p.out, /\[2\] però questo è rotto/);
  assert.doesNotMatch(p.out, /torna a chi l'ha fatto/);
  assert.match(vl(casa, 'status').out, /giro di correzione aperto/);
  // Un pass pulito resta un pass; un fail secco ferma, qualunque sia il bilancio.
  _exec('git', ['checkout', '-q', '-b', 'claude/due'], { cwd: casa });
  assert.equal(vl(casa, 'start', 'richiesta').code, 0);
  assert.match(vl(casa, 'pass', 'Regge tutto.').out, /verifica superata/);
  _exec('git', ['checkout', '-q', '-b', 'claude/tre'], { cwd: casa });
  assert.equal(vl(casa, 'start', 'richiesta').code, 0);
  assert.match(vl(casa, 'fail', 'non salva').out, /il lavoro si ferma/);
  assert.match(vl(casa, 'status').out, /bocciato/);
});

// ─── Tetto abbondante, niente taglio silenzioso (CLAUDE.md § Limiti) ────────
//
// Al giro 8 su #561 le critiche dei giri passati arrivavano mozzate a 4000
// caratteri, e i rilievi (in coda) sparivano dal brief del verificatore dopo.

test('una critica lunga entra INTERA nella storia; oltre il tetto è respinta col numero, non tagliata', async () => {
  const { MAX_CRITIQUE_CHARS, readPhase2Instructions } = await import('../../scripts/verify-local.mjs');
  const s = withRequest({}, 'r', { request: 'fai X', sha: SHA });
  const riassunto = 'provato '.repeat(700); // ~5600 caratteri: sopra il vecchio taglio a 4000
  const lunga = withCritique(s, 'r', { critique: `${riassunto}\n[2] LA PORTA ROSSA: il salvataggio non salva col titolo vuoto`, sha: SHA });
  assert.equal(lunga.outcome, 'fix');
  assert.match(lunga.state.r.critique, /LA PORTA ROSSA/, 'il rilievo in coda sopravvive: non si taglia');
  const troppa = withCritique(s, 'r', { critique: `${'x'.repeat(MAX_CRITIQUE_CHARS + 1)}\n[2] rotto`, sha: SHA });
  assert.equal(troppa.ok, false);
  assert.match(troppa.reason, /troppo lunga/);
  assert.match(troppa.reason, new RegExp(String(MAX_CRITIQUE_CHARS)), 'il rifiuto dice il tetto');
  assert.equal(troppa.state.r.verdict, undefined, 'respinta: niente scritto');
  assert.equal(typeof readPhase2Instructions, 'function');
});

test('la coda della risposta arriva da un file, non dal codice; se manca, il messaggio dice dove chiederla', () => {
  const base = { findings: [{ level: 2, text: 'rotto' }], derived: [], budgets: {}, branch: 'r' };
  const conFile = phase2Text({ ...base, instructions: 'ISTRUZIONI SEGRETE DELL\'OWNER' });
  assert.match(conFile, /ISTRUZIONI SEGRETE DELL'OWNER/);
  assert.match(conFile, /\[2\] rotto/);
  const senza = phase2Text(base);
  assert.match(senza, /CODA-GIRO-LOCALE\.md/, 'dice dove doveva essere il file');
  assert.match(senza, /verify-local\.mjs corretto/, 'e come si consegna comunque');
  assert.ok(!/adesso correggi tu/.test(senza), 'il testo delle istruzioni non vive nello strumento');
});

// ─── Giro 10 su #561: la fase 2 persa si rilegge; il pass dice se si può pubblicare davvero ───

test('#561 giro 10: la STESSA critica rimandata a correzione in sospeso ridà la stessa risposta senza scrivere né ripagare; un\'altra è respinta', () => {
  let s = withRequest({}, 'b', { request: 'X', sha: SHA });
  const testo = 'Provato.\n[2] rotto\n[0] raro';
  const prima = withCritique(s, 'b', { critique: testo, sha: SHA });
  assert.equal(prima.outcome, 'fix');
  s = prima.state;
  const snap = JSON.stringify(s);
  const ridata = withCritique(s, 'b', { critique: testo, sha: SHA });
  assert.equal(ridata.ok, true);
  assert.equal(ridata.replayed, true);
  assert.equal(ridata.outcome, 'fix');
  assert.deepEqual(ridata.decision.fix.map((f) => f.level), [2, 0]);
  assert.equal(ridata.decision.budgets.cap2.left, 4, 'i bilanci della fase 2 sono quelli del giro');
  assert.equal(JSON.stringify(ridata.state), snap, 'niente scritto');
  // La barra-n letterale è la stessa critica.
  assert.equal(withCritique(s, 'b', { critique: 'Provato.\n[2] rotto\n[0] raro', sha: SHA }).replayed, true);
  // Un testo diverso, o un altro commit, non è un replay.
  assert.equal(withCritique(s, 'b', { critique: 'Provato.\n[2] rotto in un altro modo', sha: SHA }).ok, false);
  assert.equal(withCritique(s, 'b', { critique: testo, sha: ALTRO_SHA }).ok, false);
  // Consegnata la correzione, la stessa critica non si ridà più.
  const dopo = withFixed(s, 'b', { report: 'ok', sha: ALTRO_SHA }).state;
  assert.equal(withCritique(dopo, 'b', { critique: testo, sha: SHA }).ok, false);
  // E una seconda consegna dice che è già stata consegnata, non «prima la critica».
  const bis = withFixed(dopo, 'b', { report: 'ancora', sha: ALTRO_SHA });
  assert.equal(bis.ok, false);
  assert.match(bis.reason, /già stata consegnata/);
  assert.doesNotMatch(bis.reason, /prima la critica/);
});

test('CLI giro 10: la risposta persa si rilegge (stessa critica, o status); un pass con modifiche non salvate non dice «Si può pubblicare»', () => {
  const casa = depositoUsaEGetta();
  assert.equal(vl(casa, 'start', 'richiesta').code, 0);
  const testo = 'Provato.\n[2] rotto';
  assert.match(vl(casa, 'critica', testo).out, /c'è da correggere/);
  const st = vl(casa, 'status');
  assert.match(st.out, /giro di correzione aperto/);
  assert.match(st.out, /\[2\] rotto/, 'status elenca i rilievi in sospeso');
  const ridata = vl(casa, 'critica', testo);
  assert.equal(ridata.code, 0, ridata.out);
  assert.match(ridata.out, /ristampo la fase 2/);
  assert.match(ridata.out, /Rilievi da correggere ADESSO[\s\S]*\[2\] rotto/);
  assert.match(ridata.out, /cap2: 4 giri residui su 5/, 'il giro non si ripaga');
  const altra = vl(casa, 'critica', 'Provato.\n[2] rotto diversamente');
  assert.equal(altra.code, 1);
  assert.match(altra.out, /già registrata/);
  // Pass su un albero sporco: registrato, ma senza promettere la pubblicazione.
  _exec('git', ['checkout', '-q', '-b', 'claude/sporco'], { cwd: casa });
  assert.equal(vl(casa, 'start', 'richiesta').code, 0);
  _write(resolve(casa, 'a.txt'), 'modifica non salvata', 'utf8');
  const p = vl(casa, 'critica', 'Provato: regge.');
  assert.equal(p.code, 0, p.out);
  assert.match(p.out, /verifica superata/);
  assert.doesNotMatch(p.out, /Si può pubblicare/);
  assert.match(p.out, /[Mm]odifiche non salvate/);
  assert.match(vl(casa, 'status').out, /modifiche non salvate/);
});
