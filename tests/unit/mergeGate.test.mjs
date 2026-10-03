// Il cancello di merge, dopo il trasloco sul server (SPEC-RIDISEGNO-MAX.md §10).
//
// Due cose da sorvegliare, e sono diverse:
//
//   1) L'HOOK di auto-commit NON fa atterrare niente su `main` da solo: ogni
//      branch resta sul suo ramo (è il trasporto del lavoro), e a `main` ci si
//      arriva SOLO dal cancello. Questi test usano git vero in una sandbox.
//   2) `merge-gate.mjs` è diventato il CLIENT del canale: presenta il biglietto
//      e chiede al SERVER di fondere. Qui non gira più nessun git e nessun L5
//      locale (la copia viva di L5 è sul server, filo-security): si testa il
//      contratto — biglietto + branch nel corpo, NIENT'ALTRO (nessun verdetto
//      raccontato) — e la mappa risposta → exit code, che è il contratto CLI
//      su cui il ruolo secaudit decide le chiusure:
//        0 fuso · 10 bloccato (L5) · 20 conflitto · 1 errore/rifiuto.
//      Server finto via FILO_ROUTINE_API, come in routineChain.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK = resolve(__dirname, '..', '..', '.claude', 'hooks', 'auto-commit-merge.sh');
const MERGE_GATE = resolve(__dirname, '..', '..', 'scripts', 'merge-gate.mjs');

// ─── logica pura del CLI (niente git, niente rete) ───────────────────────────

const { parseArgs, isValidBranch, exitCodeFor, testoRifiutoServer } = await import('../../scripts/merge-gate.mjs');

test('parseArgs: solo il source; qualunque flag è sconosciuto', () => {
  assert.deepEqual(parseArgs(['worker/1']), { source: 'worker/1', unknown: [] });
  // I vecchi flag non passano in silenzio: --into era il Modello B (abolito),
  // --dry-run era il merge locale (sparito col trasloco sul server).
  assert.ok(parseArgs(['worker/1', '--into', 'feature/1']).unknown.includes('--into'));
  assert.ok(parseArgs(['worker/1', '--dry-run']).unknown.includes('--dry-run'));
});

test('isValidBranch: accetta nomi tipici, rifiuta injection', () => {
  assert.ok(isValidBranch('worker/12'));
  assert.ok(isValidBranch('feature/12.final'));
  assert.ok(!isValidBranch('--force'));            // niente flag travestiti da branch
  assert.ok(!isValidBranch('a; rm -rf /'));        // niente metacaratteri shell
  assert.ok(!isValidBranch('a..b'));               // niente range
  assert.ok(!isValidBranch(''));
});

test('exitCodeFor: il contratto CLI su cui il ruolo secaudit decide le chiusure', () => {
  assert.equal(exitCodeFor({ ok: true, result: 'merged', sha: 'abc' }), 0);
  assert.equal(exitCodeFor({ ok: true, result: 'blocked', reason: 'guard_the_guards: firestore.rules' }), 10);
  assert.equal(exitCodeFor({ ok: true, result: 'conflict' }), 20);
  // Un RIFIUTO del server (verdetti non registrati, ramo che non combacia,
  // biglietto morto) è 1, non 10: non è un blocco di sicurezza da spiegare
  // all'owner, è una richiesta fuori perimetro già registrata dal server.
  assert.equal(exitCodeFor({ ok: false, reason: 'not_approved' }), 1);
  assert.equal(exitCodeFor({ ok: false, reason: 'branch_mismatch' }), 1);
  assert.equal(exitCodeFor({ ok: false, reason: 'github_unreachable' }), 1);
  // Risposte malformate: mai un finto successo.
  assert.equal(exitCodeFor({}), 1);
  assert.equal(exitCodeFor(null), 1);
  assert.equal(exitCodeFor({ ok: true }), 1);
});

// ─── il client contro un server finto ─────────────────────────────────────────

/** Server finto: risponde a /routineMerge e cattura cosa gli arriva. */
function fintoServer(risposta, status = 200) {
  const richieste = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      richieste.push({ url: req.url, body: body ? JSON.parse(body) : {} });
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = status;
      res.end(JSON.stringify(risposta));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, richieste, port: srv.address().port })));
}

/**
 * Lancia il CLI vero contro il server finto, col biglietto in env.
 *
 * ⚠️ spawn ASINCRONO, mai spawnSync: il server finto vive in QUESTO processo,
 * e spawnSync bloccherebbe l'event loop — il CLI aspetterebbe una risposta che
 * il test non può più servire. Deadlock silenzioso, già successo qui.
 */
function gate(port, args, { ticket = 'biglietto-di-prova' } = {}) {
  const casa = cartellaTemporanea('filo-mg-client-');
  // Un deposito vero, con un commit: la richiesta di fusione dichiara il
  // COMMIT da fondere e si ferma se non riesce a leggerlo o se la directory
  // ha roba fuori dai commit (#485). Una cartella qualunque non è più un
  // ambiente in cui il gate possa lavorare, e non lo è nemmeno nel giro vero.
  const g = (a) => execFileSync('git', a, { cwd: casa, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g(['init', '-q', '--initial-branch=main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  g(['commit', '-q', '--allow-empty', '-m', 'base']);
  // E POSIZIONATO sul ramo che si sta per far fondere, com'è nel giro vero: il
  // gate legge tutto dalla directory, e un nome di un altro ramo lo ferma
  // prima di ogni altra cosa (#485, verifica del giro 4).
  const ramo = String((args || [])[0] || '');
  if (/^[A-Za-z0-9._/-]+$/.test(ramo) && !ramo.startsWith('-') && !ramo.includes('..')) g(['checkout', '-q', '-b', ramo]);
  const env = {
    ...process.env,
    FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
    FILO_REPO_ROOT: casa, // il biglietto si cerca qui: deposito pulito
  };
  if (ticket) env.FILO_ROUTINE_TICKET = ticket;
  else delete env.FILO_ROUTINE_TICKET;
  return new Promise((risolvi) => {
    const p = spawn(process.execPath, [MERGE_GATE, ...args], { env });
    let stdout = ''; let stderr = '';
    p.stdout.on('data', (c) => { stdout += c; });
    p.stderr.on('data', (c) => { stderr += c; });
    p.on('close', (status) => {
      rmSync(casa, { recursive: true, force: true });
      risolvi({ status, stdout, stderr });
    });
  });
}

test('merged → exit 0, e al server arrivano biglietto, branch e il COMMIT da fondere', async () => {
  const { srv, richieste, port } = await fintoServer({ ok: true, result: 'merged', sha: 'abc123def456' });
  try {
    const r = await gate(port, ['worker/7']);
    assert.equal(r.status, 0, `exit 0 atteso (stdout: ${r.stdout} stderr: ${r.stderr})`);
    assert.match(r.stdout, /fuso su main dal server/);
    // Prima della richiesta un battito: la prova degli unit che la precede dura minuti (#929).
    assert.ok(richieste[0].url.endsWith('/routineHeartbeat'), richieste.map((x) => x.url).join(' '));
    const fusioni = richieste.filter((x) => x.url.endsWith('/routineMerge'));
    assert.equal(fusioni.length, 1);
    // Il contratto che chiude il buco: nessun verdetto viaggia nel corpo. Se
    // un giorno qualcuno reinfilasse un FILO_L4_VERDICT, questo diventa rosso.
    // Lo `sha` invece c'è, e non è un verdetto: dice su quale contenuto
    // giravano i controlli, come fa il cammino locale (#485).
    assert.deepEqual(Object.keys(fusioni[0].body).sort(), ['branch', 'sha', 'ticket']);
    assert.equal(fusioni[0].body.ticket, 'biglietto-di-prova');
    assert.equal(fusioni[0].body.branch, 'worker/7');
    assert.match(String(fusioni[0].body.sha), /^[0-9a-f]{40}$/);
  } finally { srv.close(); }
});

// ─── il lavoro resta vivo mentre girano gli unit sulla fusione (#929, verifica giro 3) ───

const { attesaBattito } = await import('../../scripts/routine-channel.mjs');
const { tieniVivo } = await import('../../scripts/merge-gate.mjs');

test('il battito si fa dentro la scadenza detta dal server: dieci minuti con un\'ora, più fitto con meno', () => {
  const ora = Date.parse('2026-10-03T10:00:00Z');
  const fra = (ms) => new Date(ora + ms).toISOString();
  assert.equal(attesaBattito(fra(60 * 60 * 1000), ora), 10 * 60 * 1000);
  assert.equal(attesaBattito(fra(6000), ora), 2000);
  assert.equal(attesaBattito(fra(1500), ora), 1000);
  assert.equal(attesaBattito('', ora), 10 * 60 * 1000);
  assert.equal(attesaBattito('non una data', ora), 10 * 60 * 1000);
});

test('tieniVivo: un battito subito, poi un figlio che batte col biglietto nell\'ambiente, fermato alla fine', async () => {
  const battuti = [];
  let avviato = null;
  let ucciso = false;
  const v = await tieniVivo('biglietto-x', {
    batti: async (t) => { battuti.push(t); return { ok: true }; },
    avvia: (cmd, args, opz) => { avviato = { cmd, args, opz }; return { on() {}, kill() { ucciso = true; } }; },
    script: 'canale.mjs',
  });
  assert.deepEqual(battuti, ['biglietto-x']);
  assert.deepEqual(avviato.args, ['canale.mjs', 'heartbeat', '--loop']);
  assert.equal(avviato.opz.env.FILO_ROUTINE_TICKET, 'biglietto-x');
  assert.ok(!avviato.args.includes('biglietto-x'), 'il biglietto non sta nella riga di comando');
  assert.equal(ucciso, false);
  v.ferma();
  assert.equal(ucciso, true);
});

test('una prova degli unit più lunga della finestra di silenzio non fa arrivare la fusione a biglietto morto', async () => {
  const SILENZIO_MS = 8000;
  const casa = cartellaTemporanea('filo-mg-battito-');
  const g = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  let ultimoSegno = Date.now();
  const vie = [];
  const srv = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      const vivo = Date.now() - ultimoSegno <= SILENZIO_MS;
      vie.push(`${req.url}${vivo ? '' : ' (morto)'}`);
      res.setHeader('Content-Type', 'application/json');
      if (!vivo) { res.statusCode = 403; res.end(JSON.stringify({ ok: false, reason: 'dead_ticket' })); return; }
      ultimoSegno = Date.now();
      if (req.url.endsWith('/routineHeartbeat')) res.end(JSON.stringify({ ok: true, expiresAt: new Date(ultimoSegno + SILENZIO_MS).toISOString() }));
      else res.end(JSON.stringify({ ok: true, result: 'merged', sha: 'f'.repeat(40) }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const origin = join(casa, 'origin.git');
    const lavoro = join(casa, 'lavoro');
    const altro = join(casa, 'altro');
    g(casa, 'init', '-q', '--bare', '--initial-branch=main', origin);
    g(casa, 'clone', '-q', origin, lavoro);
    for (const f of ['scripts/run-unit-tests.mjs', 'scripts/lib/riga-di-comando.mjs']) {
      mkdirSync(dirname(join(lavoro, f)), { recursive: true });
      copyFileSync(resolve(__dirname, '..', '..', f), join(lavoro, f));
    }
    mkdirSync(join(lavoro, 'tests', 'unit'), { recursive: true });
    writeFileSync(join(lavoro, 'package.json'), '{"type":"module"}\n');
    writeFileSync(join(lavoro, 'tests', 'unit', 'base.test.mjs'), "import test from 'node:test'; test('base', () => {});\n");
    g(lavoro, 'add', '-A'); g(lavoro, 'commit', '-qm', 'base'); g(lavoro, 'push', '-q', 'origin', 'main');
    g(casa, 'clone', '-q', origin, altro);
    writeFileSync(join(altro, 'nuovo.txt'), 'main va avanti\n');
    g(altro, 'add', '-A'); g(altro, 'commit', '-qm', 'main avanti'); g(altro, 'push', '-q', 'origin', 'main');
    g(lavoro, 'checkout', '-q', '-b', 'claude/lungo');
    writeFileSync(join(lavoro, 'tests', 'unit', 'lungo.test.mjs'), `import test from 'node:test'; test('lungo', async () => { await new Promise((r) => setTimeout(r, ${SILENZIO_MS * 2})); });\n`);
    g(lavoro, 'add', '-A'); g(lavoro, 'commit', '-qm', 'ramo'); g(lavoro, 'push', '-q', 'origin', 'claude/lungo');
    const tmp = join(casa, 'tmp');
    mkdirSync(tmp);
    ultimoSegno = Date.now();
    const esito = await new Promise((ok) => {
      const env = { ...process.env, FILO_REPO_ROOT: lavoro, FILO_ROUTINE_TICKET: 'biglietto-lungo', FILO_ROUTINE_API: `http://127.0.0.1:${srv.address().port}`, TEMP: tmp, TMP: tmp, TMPDIR: tmp };
      const p = spawn(process.execPath, [MERGE_GATE, 'claude/lungo'], { cwd: lavoro, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      p.stdout.on('data', (c) => { out += c; });
      p.stderr.on('data', (c) => { out += c; });
      p.on('close', (code) => ok({ code, out }));
    });
    assert.equal(esito.code, 0, `${esito.out}\n${vie.join('\n')}`);
    assert.ok(vie.some((v) => v === '/routineMerge'), vie.join('\n'));
  } finally {
    srv.close();
    rmSync(casa, { recursive: true, force: true });
  }
});

test('blocked (L5 sul server) → exit 10, col motivo del blocco', async () => {
  const { srv, port } = await fintoServer({ ok: true, result: 'blocked', reason: 'guard_the_guards: firestore.rules' });
  try {
    const r = await gate(port, ['worker/13']);
    assert.equal(r.status, 10, `exit 10 atteso (stdout: ${r.stdout} stderr: ${r.stderr})`);
    assert.match(r.stderr, /BLOCKED/);
    assert.match(r.stderr, /firestore\.rules/);
  } finally { srv.close(); }
});

test('conflict → exit 20', async () => {
  const { srv, port } = await fintoServer({ ok: true, result: 'conflict', reason: 'conflitto di merge: serve risoluzione manuale' });
  try {
    const r = await gate(port, ['worker/9']);
    assert.equal(r.status, 20, `exit 20 atteso (stdout: ${r.stdout} stderr: ${r.stderr})`);
    assert.match(r.stderr, /CONFLICT/);
  } finally { srv.close(); }
});

test('rifiuto del server (verdetti non registrati) → exit 1, col motivo', async () => {
  const { srv, port } = await fintoServer({ ok: false, reason: 'not_approved' }, 401);
  try {
    const r = await gate(port, ['worker/11']);
    assert.equal(r.status, 1, `exit 1 atteso (stdout: ${r.stdout} stderr: ${r.stderr})`);
    assert.match(r.stderr, /not_approved/);
  } finally { srv.close(); }
});

// #773: il server lega anche il via libera di sicurezza al commit. Quando non
// copre la punta lo azzera e rimanda da sé un nuovo controllo: chi ha chiesto
// la fusione deve leggerlo, non un «ERROR» che sembra un guasto.
test('via libera di sicurezza decaduto sul server → exit 1, e la frase dice che non c’è altro da fare', async () => {
  for (const reason of ['secaudit_stale', 'stale']) {
    const { srv, port } = await fintoServer({ ok: false, reason }, 401);
    try {
      const r = await gate(port, ['worker/12']);
      assert.equal(r.status, 1, `exit 1 atteso (stdout: ${r.stdout} stderr: ${r.stderr})`);
      assert.match(r.stderr, new RegExp(`RIFIUTATO \\(${reason}\\)`));
      assert.match(r.stderr, /nuovo controllo sulla punta/);
      assert.match(r.stderr, /rilascia il biglietto/);
      assert.doesNotMatch(r.stderr, /ERROR/);
    } finally { srv.close(); }
  }
});

test('testoRifiutoServer: una frase per i due motivi del #773, niente per gli altri', () => {
  assert.notEqual(testoRifiutoServer('secaudit_stale'), testoRifiutoServer('stale'));
  for (const reason of ['not_approved', 'branch_mismatch', 'malformed', '', undefined]) {
    assert.equal(testoRifiutoServer(reason), '', String(reason));
  }
});

test('senza biglietto → exit 1 SENZA nemmeno chiamare il server', async () => {
  const { srv, richieste, port } = await fintoServer({ ok: true, result: 'merged' });
  try {
    const r = await gate(port, ['worker/7'], { ticket: '' });
    assert.equal(r.status, 1, `exit 1 atteso (stdout: ${r.stdout} stderr: ${r.stderr})`);
    assert.match(r.stderr, /biglietto/);
    assert.equal(richieste.length, 0, 'senza biglietto non c’è niente da chiedere');
  } finally { srv.close(); }
});

test('il vecchio --into viene rifiutato prima di qualunque chiamata', async () => {
  const { srv, richieste, port } = await fintoServer({ ok: true, result: 'merged' });
  try {
    const r = await gate(port, ['worker/9.1', '--into', 'feature/9']);
    assert.equal(r.status, 1, `exit 1 atteso (stdout: ${r.stdout} stderr: ${r.stderr})`);
    assert.match(r.stderr, /--into/);
    assert.equal(richieste.length, 0);
  } finally { srv.close(); }
});

test('branch con injection → exit 1 senza chiamate', async () => {
  const { srv, richieste, port } = await fintoServer({ ok: true, result: 'merged' });
  try {
    const r = await gate(port, ['a;rm -rf /']);
    assert.equal(r.status, 1);
    assert.equal(richieste.length, 0);
  } finally { srv.close(); }
});

// ─── l'hook: nessun branch arriva su main da solo (git vero, sandbox) ─────────

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function hasGit() {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// Esegue l'hook come fa Claude Code: bash con CLAUDE_PROJECT_DIR = dir corrente.
function runHook(dir) {
  return spawnSync('bash', [HOOK], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, FILO_MAIN_BRANCH: 'main' },
  });
}

// Il commit sull'origin (bare) per <branch> contiene <file>?
function originHasFile(origin, branch, file) {
  const r = spawnSync('git', ['--git-dir=' + origin, 'ls-tree', '-r', '--name-only', branch], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.split('\n').includes(file);
}

// L'origin (bare) ha il ref di branch?
function originHasBranch(origin, branch) {
  const r = spawnSync('git', ['--git-dir=' + origin, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
  return r.status === 0;
}

function setupOrigin(base) {
  const origin = join(base, 'origin.git');
  const seed = join(base, 'seed');
  git(base, ['init', '--bare', '-b', 'main', origin]);
  git(base, ['clone', '-q', origin, seed]);
  git(seed, ['config', 'user.email', 't@t']); git(seed, ['config', 'user.name', 't']);
  writeFileSync(join(seed, 'README.md'), 'seed\n');
  git(seed, ['add', '-A']); git(seed, ['commit', '-q', '-m', 'seed']); git(seed, ['push', '-q', 'origin', 'main']);
  return origin;
}

function freshClone(base, origin, name) {
  const dir = join(base, name);
  git(base, ['clone', '-q', origin, dir]);
  git(dir, ['config', 'user.email', 't@t']); git(dir, ['config', 'user.name', 't']);
  return dir;
}

const skip = !hasGit() ? 'git non disponibile' : false;

// ⚠️ Questo test asseriva l'OPPOSTO fino al 2026-08-07 ("un branch normale
// viene ancora auto-pushato su main"): era il comportamento che permetteva a
// un'istanza su un branch dal nome qualsiasi di pubblicare senza passare dal
// cancello. Ora nessun branch di lavoro raggiunge main da solo — ci si arriva
// una volta sola, a lavoro finito (`npm run finish` / il cancello sul server).
// Spec: ROUTINE-BRANCH-INTEGRITY.md §Via 1.
test('nessun branch di lavoro arriva su main da solo, nemmeno con un nome qualsiasi', { skip }, () => {
  const base = cartellaTemporanea('filo-mg-normal-');
  try {
    const origin = setupOrigin(base);
    const r = freshClone(base, origin, 'routine');
    git(r, ['checkout', '-q', '-b', 'claude/foo']);
    writeFileSync(join(r, 'normal.txt'), 'change on a normal branch\n');
    const out = runHook(r);
    assert.equal(out.status, 0, `hook exit 0 (stderr: ${out.stderr})`);
    assert.ok(!originHasFile(origin, 'main', 'normal.txt'),
      'una modifica in corso non deve raggiungere main: da lì viene distribuita agli utenti ogni 6 ore');
    assert.ok(originHasFile(origin, 'claude/foo', 'normal.txt'),
      'ma deve essere al sicuro sul suo branch: è ciò che salva il lavoro se la sessione si interrompe');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('un branch worker/* NON arriva su main, ma resta sul suo branch', { skip }, () => {
  const base = cartellaTemporanea('filo-mg-worker-');
  try {
    const origin = setupOrigin(base);
    const r = freshClone(base, origin, 'routine');
    git(r, ['checkout', '-q', '-b', 'worker/42']);
    writeFileSync(join(r, 'worker.txt'), 'unverified change\n');
    const out = runHook(r);
    assert.equal(out.status, 0, `hook exit 0 (stderr: ${out.stderr})`);
    // Il cancello: NON deve toccare main.
    assert.ok(!originHasFile(origin, 'main', 'worker.txt'),
      'una edit su worker/* NON deve atterrare su main senza passare dal cancello');
    // Ma deve essere pushato sul suo branch (tracciabilità + lo vede il server).
    assert.ok(originHasBranch(origin, 'worker/42'), 'il branch worker/42 deve esistere su origin');
    assert.ok(originHasFile(origin, 'worker/42', 'worker.txt'),
      'la edit deve essere committata e pushata sul branch worker/42');
  } finally { rmSync(base, { recursive: true, force: true }); }
});
