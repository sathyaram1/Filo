// Il verdetto di verify-local con un ramo omonimo nel checkout del server (#1062): lo sha verificato è una coppia,
// `corretto` vede i commit di tutti e due i rami, un server mosso dopo il verdetto lo fa decadere, e server:fondi
// fonde solo lo sha verificato. Logica pura e poi i comandi veri su due repo usa-e-getta, app e server affiancati.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';
import {
  checkoutDelRamo, confrontaServer, soloFusioniPulite, statoRamoServer, testoServerMossoDallAvvio,
} from '../../scripts/lib/ramo-server.mjs';
import { perimetroNote } from '../../scripts/lib/verifier-scope.mjs';

const VL = await import('../../scripts/verify-local.mjs');
const CAPS = { cap3: 5, cap2: 5, cap1: 2, cap0: 0 };
const A = 'a'.repeat(40);
const S1 = '1'.repeat(40);
const S2 = '2'.repeat(40);
const ora = (o) => ({ ramo: 'claude/x', sha: S1, sporchi: [], dentroMain: false, verificatoInMain: false, soloFusioniDiMain: false, ...o });

test('confrontaServer: regge solo lo stesso server, o quello che non aggiunge niente a main', () => {
  const v = { ramo: 'claude/x', sha: S1 };
  assert.deepEqual(confrontaServer(v, ora()), { ok: true, sha: S1 });
  assert.equal(confrontaServer(null, null).ok, true, 'niente server, niente da confrontare');
  assert.equal(confrontaServer(null, ora({ sha: '' })).ok, true);
  assert.equal(confrontaServer(null, ora({ dentroMain: true })).ok, true, 'un ramo omonimo già tutto su main non porta niente');
  assert.equal(confrontaServer(v, ora({ sha: '', verificatoInMain: true })).ok, true, 'fuso e cancellato: lo sha verificato è su main');
  assert.equal(confrontaServer(v, ora({ sha: S2, soloFusioniDiMain: true })).tollerato, true);
  const no = [
    [v, ora({ sha: S2 }), /si è mosso dopo la verifica \(11111111 → 22222222\)/],
    [null, ora(), /fuori da main del server che la verifica non comprendeva/],
    [v, null, /non trovo il checkout del server/],
    [v, ora({ sha: '' }), /non c'è più e quel commit non è su main/],
    [v, ora({ sporchi: [' M functions/index.js'], checkout: '/srv' }), /modifiche non salvate[\s\S]*functions\/index\.js/],
    [v, ora({ sha: S2, dentroMain: true }), /si è mosso/],
  ];
  for (const [a, b, motivo] of no) {
    const r = confrontaServer(a, b);
    assert.equal(r.ok, false, JSON.stringify([a, b]));
    assert.match(r.reason, motivo);
  }
});

test('checkVerdict: il pass decade se il server si muove, e chi non guarda il server non lo conferma', () => {
  const entry = { verdict: 'pass', sha: A, server: { ramo: 'claude/x', sha: S1 } };
  const ok = VL.checkVerdict(entry, A, false, null, ora());
  assert.equal(ok.ok, true);
  assert.match(ok.reason, /insieme al ramo del server claude\/x su 11111111/);
  assert.deepEqual(ok.server, { ramo: 'claude/x', sha: S1, tollerato: false });
  const mosso = VL.checkVerdict(entry, A, false, null, ora({ sha: S2 }));
  assert.equal(mosso.ok, false);
  assert.match(mosso.reason, /si è mosso dopo la verifica/);
  assert.equal(VL.checkVerdict(entry, A).ok, false, 'senza lo stato del server il verdetto che lo comprende non regge');
  // Un verdetto senza server, e un server che nel frattempo ha commit suoi: la verifica non li ha visti.
  assert.equal(VL.checkVerdict({ verdict: 'pass', sha: A }, A, false, null, ora()).ok, false);
  assert.equal(VL.checkVerdict({ verdict: 'pass', sha: A }, A, false, null, null).ok, true);
  assert.equal(VL.checkVerdict({ verdict: 'pass', sha: A }, A).ok, true, 'senza server la regola di sempre');
});

test('withCritique lega il verdetto al server; un server con modifiche non salvate respinge la critica', () => {
  const s = VL.withRequest({}, 'r', { request: 'fai X', sha: A, server: ora() });
  assert.deepEqual(s.r.requestedServer, { ramo: 'claude/x', sha: S1 });
  const pass = VL.withCritique(s, 'r', { critique: 'Provato tutto, app e server: funziona.', sha: A, caps: CAPS, server: ora() });
  assert.deepEqual(pass.state.r.server, { ramo: 'claude/x', sha: S1 });
  const fix = VL.withCritique(s, 'r', { critique: 'Provato.\n[2i] il server non salva', sha: A, caps: CAPS, server: ora() });
  assert.equal(fix.state.r.pending.serverSha, S1);
  const sporco = VL.withCritique(s, 'r', { critique: 'Provato tutto: funziona.', sha: A, caps: CAPS, server: ora({ sporchi: [' M a.js'], checkout: '/srv' }) });
  assert.equal(sporco.ok, false);
  assert.match(sporco.reason, /critica non registrata: nel checkout del server \(\/srv\)/);
  assert.equal(sporco.state.r.verdict, undefined);
});

test('withFixed: una correzione solo sul server è una correzione (#715), e il giro dopo sa da dove parte', () => {
  const s = VL.withRequest({}, 'r', { request: 'fai X', sha: A, server: ora() });
  const fix = VL.withCritique(s, 'r', { critique: 'Provato.\n[2i] il server non salva', sha: A, caps: CAPS, server: ora() });
  const soloServer = VL.withFixed(fix.state, 'r', { report: 'corretto il server', sha: A, server: ora({ sha: S2 }) });
  assert.equal(soloServer.outcome, 'fixed', 'senza #1062 qui usciva «verifica superata» col rilievo non corretto');
  assert.equal(soloServer.state.r.verdict, 'fixed');
  assert.deepEqual(soloServer.state.r.chiusura.shaPrimaServer, S1);
  assert.match(perimetroNote('chiusura', soloServer.state.r.chiusura), /ramo del server claude\/x: nel checkout di filo-security il diff è `git diff 1{40}\.\.claude\/x`/);
  const niente = VL.withFixed(fix.state, 'r', { report: 'niente', sha: A, server: ora() });
  assert.equal(niente.outcome, 'stop', 'nessun commit nuovo da nessuna parte: il 2 resta aperto');
  const nato = VL.withFixed(VL.withCritique(VL.withRequest({}, 'r', { request: 'X', sha: A }), 'r', { critique: 'Provato.\n[2i] manca il server', sha: A, caps: CAPS }).state,
    'r', { report: 'aggiunto il server', sha: A, server: ora() });
  assert.equal(nato.outcome, 'fixed', 'un ramo del server nato con la correzione è un commit nuovo');
  assert.match(perimetroNote('chiusura', nato.state.r.chiusura), /è nato con la correzione: .*git diff origin\/main\.\.\.claude\/x/);
  const sporco = VL.withFixed(fix.state, 'r', { report: 'corretto', sha: A, server: ora({ sha: S2, sporchi: [' M a.js'], checkout: '/srv' }) });
  assert.equal(sporco.ok, false);
  assert.match(sporco.reason, /consegna non registrata: nel checkout del server/);
});

test('testoServerMossoDallAvvio, checkoutDelRamo e il nome del ramo nel perimetro', () => {
  assert.equal(testoServerMossoDallAvvio({ ramo: 'claude/x', sha: S1 }, ora()), '');
  assert.equal(testoServerMossoDallAvvio(null, null), '');
  assert.equal(testoServerMossoDallAvvio(null, ora({ dentroMain: true })), '', 'nato da main senza commit suoi');
  assert.match(testoServerMossoDallAvvio({ ramo: 'claude/x', sha: S1 }, ora({ sha: S2 })), /si è mosso \(11111111 → 22222222\)[\s\S]*riportalo a 11111111/);
  assert.match(testoServerMossoDallAvvio(null, ora()), /è comparso il ramo del server claude\/x/);
  const porcelain = 'worktree /a\nHEAD 1\nbranch refs/heads/main\n\nworktree /b c\nHEAD 2\nbranch refs/heads/claude/x\n';
  assert.equal(checkoutDelRamo(porcelain, 'claude/x'), '/b c');
  assert.equal(checkoutDelRamo(porcelain, 'claude/y'), '');
  assert.doesNotMatch(perimetroNote('chiusura', { rilievi: [], shaPrima: A, ramoServer: 'claude/x; rm -rf /', shaPrimaServer: S1 }), /rm -rf/);
});

// ─── I comandi veri: app in <base>/work, server in <base>/filo-security, come sulla macchina dell'owner ──────────

const VERIFY = fileURLToPath(new URL('../../scripts/verify-local.mjs', import.meta.url));
const RAMO = 'claude/prova';
const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const scrivi = (dir, file, testo) => { mkdirSync(resolve(dir, file, '..'), { recursive: true }); writeFileSync(resolve(dir, file), testo, 'utf8'); };
const commit = (dir, file, testo, msg) => { scrivi(dir, file, testo); g(dir, 'add', '-A'); g(dir, 'commit', '-q', '-m', msg); return g(dir, 'rev-parse', 'HEAD'); };
const identita = (dir) => { g(dir, 'config', 'user.email', 't@t'); g(dir, 'config', 'user.name', 't'); };

const FINTO = await (async () => {
  const helper = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'helpers', 'finto-config-routines.mjs');
  const p = spawn(process.execPath, [helper], { env: { ...process.env, FINTO_CAPS: JSON.stringify(CAPS) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const port = await new Promise((ok, no) => {
    let so = '';
    p.stdout.on('data', (c) => { so += c; const m = so.match(/PORT=(\d+)/); if (m) ok(Number(m[1])); });
    p.on('exit', (code) => no(new Error(`server finto uscito con ${code}`)));
    setTimeout(() => no(new Error('server finto: nessuna porta entro 15 s')), 15000).unref();
  });
  p.unref(); p.stdout.unref(); p.stderr.unref();
  process.on('exit', () => { try { p.kill(); } catch (_) { /* già morto */ } });
  return `http://127.0.0.1:${port}/config/routines`;
})();

function scenario() {
  const base = cartellaTemporanea('filo-ramo-server-');
  const work = resolve(base, 'work');
  const server = resolve(base, 'filo-security');
  const srvOrigin = resolve(base, 'srv-origin.git');
  mkdirSync(work);
  g(work, 'init', '-q', '-b', 'main');
  identita(work);
  scrivi(work, '.gitignore', '.claude/\n');
  commit(work, 'app.txt', 'app\n', 'app');
  g(work, 'checkout', '-q', '-b', RAMO);
  commit(work, 'lavoro.txt', 'lavoro\n', 'lavoro dell\'app');

  mkdirSync(srvOrigin);
  g(srvOrigin, 'init', '--bare', '-q', '--initial-branch=main');
  mkdirSync(server);
  g(server, 'init', '-q', '-b', 'main');
  identita(server);
  g(server, 'remote', 'add', 'origin', srvOrigin);
  commit(server, 'functions/tools/server-fondi.js', '// finto\n', 'server');
  commit(server, 'functions/index.js', 'uno\n', 'index');
  g(server, 'push', '-q', 'origin', 'refs/heads/main:refs/heads/main');
  g(server, 'checkout', '-q', '-b', RAMO);
  commit(server, 'functions/lavoro.js', 'v1\n', 'lavoro del server');
  g(server, 'push', '-q', '-u', 'origin', `refs/heads/${RAMO}:refs/heads/${RAMO}`);
  return { base, work, server, srvOrigin };
}

function vl(work, ...args) {
  try {
    const out = execFileSync(process.execPath, [VERIFY, ...args], {
      cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FILO_REPO_ROOT: work, FILO_ROUTINE_CONFIG_URL: FINTO, FILO_ADMIN_ID_TOKEN: 'finto-id-token' },
    });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; }
}

const PASS = 'Provato il lavoro intero, app e server insieme, con inserimenti vuoti e lunghi: regge in ogni caso provato.';
const FIX = 'Provato il lavoro intero, app e server insieme: l\'app regge, il server no.\n[2i] il server non salva il campo nuovo';

function verificato(sc) {
  assert.equal(vl(sc.work, 'start', 'fai X su app e server').code, 0);
  const c = vl(sc.work, 'critica', PASS);
  assert.equal(c.code, 0, c.out);
  assert.match(c.out, /verifica superata per 'claude\/prova' su [0-9a-f]{8} e il server claude\/prova su [0-9a-f]{8}/);
}

test('#715: una correzione fatta solo sul ramo del server non passa per «verifica superata»', () => {
  const sc = scenario();
  const avvio = vl(sc.work, 'start', 'fai X su app e server');
  assert.equal(avvio.code, 0, avvio.out);
  assert.match(avvio.out, /PARTE DEL SERVER: il ramo claude\/prova di filo-security/);
  assert.match(avvio.out, /Parte del server: claude\/prova di filo-security su [0-9a-f]{8}/);
  assert.equal(vl(sc.work, 'critica', FIX).code, 0);
  commit(sc.server, 'functions/lavoro.js', 'v2, corretto\n', 'correzione del server');
  const c = vl(sc.work, 'corretto', 'Corretto il salvataggio del campo nuovo nel server; l\'app non andava toccata.');
  assert.equal(c.code, 0, c.out);
  assert.match(c.out, /Correzione consegnata/);
  assert.doesNotMatch(c.out, /Verifica superata/);
  const st = vl(sc.work, 'status');
  assert.equal(st.code, 1, 'la correzione del server deve passare da un\'altra verifica');
  assert.match(st.out, /serve un'altra verifica/);
  const giro2 = vl(sc.work, 'start');
  assert.match(giro2.out, /La correzione è passata anche dal ramo del server claude\/prova|PARTE DEL SERVER/);
  assert.equal(vl(sc.work, 'critica', PASS).code, 0);
  const ok = vl(sc.work, 'status');
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /insieme al ramo del server claude\/prova/);
});

test('un commit sul ramo del server dopo il verdetto lo fa decadere: status, finish e server:fondi dicono di no', () => {
  const sc = scenario();
  verificato(sc);
  assert.equal(VL.verdettoDelRamo(RAMO, { radice: sc.work }).ok, true);
  commit(sc.server, 'functions/lavoro.js', 'v2\n', 'dopo il verdetto');
  const st = vl(sc.work, 'status');
  assert.equal(st.code, 1);
  assert.match(st.out, /il ramo del server claude\/prova si è mosso dopo la verifica/);
  const v = VL.verdettoDelRamo(RAMO, { radice: sc.work });
  assert.equal(v.ok, false);
  assert.match(v.reason, /si è mosso dopo la verifica/);
  // Riportato dov'era, il verdetto torna a valere: conta il contenuto, non la storia.
  g(sc.server, 'reset', '-q', '--hard', 'HEAD~1');
  assert.equal(vl(sc.work, 'status').code, 0);
});

test('server:fondi guarda la punta su origin, quella che fonde', () => {
  const sc = scenario();
  verificato(sc);
  const altro = resolve(sc.base, 'altro-server');
  execFileSync('git', ['clone', '-q', '--branch', RAMO, sc.srvOrigin, altro], { stdio: ['ignore', 'pipe', 'pipe'] });
  identita(altro);
  commit(altro, 'functions/lavoro.js', 'da un\'altra macchina\n', 'spinto da fuori');
  g(altro, 'push', '-q', 'origin', `refs/heads/${RAMO}:refs/heads/${RAMO}`);
  assert.equal(vl(sc.work, 'status').code, 0, 'in locale il ramo è ancora quello verificato');
  const v = VL.verdettoDelRamo(RAMO, { radice: sc.work });
  assert.equal(v.ok, false);
  assert.match(v.reason, /^su origin: .*si è mosso dopo la verifica/);
});

test('una fusione pulita di main del server dopo il verdetto (server:fondi la chiede) lo lascia valido; una risolta a mano no', () => {
  const sc = scenario();
  verificato(sc);
  const altro = resolve(sc.base, 'altro-main');
  execFileSync('git', ['clone', '-q', sc.srvOrigin, altro], { stdio: ['ignore', 'pipe', 'pipe'] });
  identita(altro);
  commit(altro, 'functions/altro.js', 'altro lavoro\n', 'main avanza');
  g(altro, 'push', '-q', 'origin', 'refs/heads/main:refs/heads/main');
  g(sc.server, 'fetch', '-q', 'origin');
  g(sc.server, 'merge', '-q', '--no-edit', 'origin/main');
  const st = vl(sc.work, 'status');
  assert.equal(st.code, 0, st.out);
  assert.match(st.out, /dopo è entrato solo main del server/);
  assert.equal(VL.verdettoDelRamo(RAMO, { radice: sc.work }).ok, true);

  // Un conflitto risolto è contenuto che nessuno ha verificato.
  commit(altro, 'functions/index.js', 'main\n', 'main tocca index');
  g(altro, 'push', '-q', 'origin', 'refs/heads/main:refs/heads/main');
  scrivi(sc.server, 'functions/index.js', 'ramo\n');
  g(sc.server, 'commit', '-q', '-am', 'il ramo tocca index');
  g(sc.server, 'reset', '-q', '--hard', 'HEAD~1');
  const prima = g(sc.server, 'rev-parse', 'HEAD');
  commit(sc.server, 'functions/index.js', 'ramo\n', 'il ramo tocca index');
  g(sc.server, 'fetch', '-q', 'origin');
  try { g(sc.server, 'merge', '--no-edit', 'origin/main'); } catch (_) { /* conflitto atteso */ }
  scrivi(sc.server, 'functions/index.js', 'risolto a mano\n');
  g(sc.server, 'commit', '-q', '-am', 'fusione risolta');
  const radice = sc.server;
  const fusione = g(radice, 'rev-parse', 'HEAD');
  assert.equal(soloFusioniPulite((cwd, a) => { try { return g(cwd, ...a); } catch (_) { return null; } }, radice, prima, fusione, 'refs/remotes/origin/main'), false);
  assert.equal(vl(sc.work, 'status').code, 1, 'e comunque qui c\'era un commit nuovo del ramo');
});

test('una fusione di un ramo che non è main non è tollerata', () => {
  const sc = scenario();
  verificato(sc);
  const v = g(sc.server, 'rev-parse', 'HEAD');
  g(sc.server, 'checkout', '-q', '-b', 'claude/altro', 'main');
  commit(sc.server, 'functions/estraneo.js', 'mai verificato\n', 'estraneo');
  g(sc.server, 'checkout', '-q', RAMO);
  g(sc.server, 'merge', '-q', '--no-edit', 'claude/altro');
  const s = statoRamoServer(RAMO, { cartellaServer: join(sc.server, 'functions'), shaVerificato: v });
  assert.equal(s.soloFusioniDiMain, false);
  assert.equal(vl(sc.work, 'status').code, 1);
});

test('la critica si rifiuta se il server si è mosso dall\'avvio o ha modifiche non salvate', () => {
  const sc = scenario();
  assert.equal(vl(sc.work, 'start', 'fai X su app e server').code, 0);
  const sha = g(sc.server, 'rev-parse', 'HEAD');
  commit(sc.server, 'functions/lavoro.js', 'toccato durante la verifica\n', 'durante');
  const mosso = vl(sc.work, 'critica', PASS);
  assert.equal(mosso.code, 1);
  assert.match(mosso.out, /dall'avvio della verifica il ramo del server claude\/prova si è mosso/);
  g(sc.server, 'reset', '-q', '--hard', sha);
  scrivi(sc.server, 'functions/lavoro.js', 'non salvato\n');
  scrivi(sc.server, 'functions/node_modules', 'collegamento\n');
  const sporco = vl(sc.work, 'critica', PASS);
  assert.equal(sporco.code, 1);
  assert.match(sporco.out, /modifiche non salvate[\s\S]*functions\/lavoro\.js/);
  assert.doesNotMatch(sporco.out, /node_modules/, 'un file che git non segue non conta');
  g(sc.server, 'checkout', '--', 'functions/lavoro.js');
  assert.equal(vl(sc.work, 'critica', PASS).code, 0);
  assert.equal(vl(sc.work, 'status').code, 0);
});

test('senza checkout del server accanto, tutto come prima', () => {
  const base = cartellaTemporanea('filo-senza-server-');
  const work = resolve(base, 'work');
  mkdirSync(work);
  g(work, 'init', '-q', '-b', 'main');
  identita(work);
  scrivi(work, '.gitignore', '.claude/\n');
  commit(work, 'app.txt', 'app\n', 'app');
  g(work, 'checkout', '-q', '-b', RAMO);
  assert.equal(vl(work, 'start', 'fai X').code, 0);
  const c = vl(work, 'critica', PASS);
  assert.match(c.out, /verifica superata per 'claude\/prova' su [0-9a-f]{8} ══/);
  assert.equal(vl(work, 'status').code, 0);
  assert.equal(VL.verdettoDelRamo('claude/nessuno', { radice: work }), null, 'nessuna verifica di un ramo omonimo: server:fondi come prima');
});
