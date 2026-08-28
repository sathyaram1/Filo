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
  checkVerdict, withRequest, withVerdict, buildVerifierBrief,
  realignPlan, afterRebase,
} = await import('../../scripts/verify-local.mjs');

const SHA = 'a'.repeat(40);
const ALTRO_SHA = 'b'.repeat(40);

test('checkVerdict: senza verifica non si pubblica', () => {
  assert.equal(checkVerdict(undefined, SHA).ok, false);
  assert.equal(checkVerdict(null, SHA).ok, false);
  // Verifica avviata ma mai conclusa: vale come non fatta.
  assert.equal(checkVerdict({ request: 'fai X', requestedSha: SHA }, SHA).ok, false);
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
  clone(altro);
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
