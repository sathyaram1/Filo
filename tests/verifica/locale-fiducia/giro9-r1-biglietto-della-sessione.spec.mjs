// Verifica locale «fiducia» (#1148), giro 9, rilievo 1: da un comando senza la variabile del biglietto (PowerShell) valgono
// i biglietti di tutte le sessioni del repo, non quello della sessione. Funzioni vere dell'app, callable vera, Firestore in memoria.
import { test, expect } from './../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const RADICE = join(import.meta.dirname, '..', '..', '..');
function funzioniDelServer() {
  let ramo = '';
  try { ramo = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: RADICE, encoding: 'utf8' }).trim(); } catch (_) {}
  const slug = ramo.replace(/^claude\//, '');
  let d = RADICE;
  for (let i = 0; i < 8; i++) {
    const srv = join(dirname(d), 'filo-security');
    for (const c of [join(srv, '.claude', 'worktrees', slug, 'functions'), join(srv, 'functions')]) {
      if (slug && existsSync(join(c, 'src', 'routine', 'localTicket.js'))) return c;
    }
    d = dirname(d);
  }
  return '';
}
const SRV = funzioniDelServer();

function server() {
  const require = createRequire(join(SRV, 'index.js'));
  const { memFirestore } = require(join(SRV, 'test', 'fixtures', 'firestore-mem'));
  const fsMod = require(join(SRV, 'src', 'data', 'firestore'));
  const mem = memFirestore({});
  fsMod.db = () => mem();
  const store = require(join(SRV, 'src', 'routine', 'store'));
  const { runLocalTicket } = require(join(SRV, 'src', 'routine', 'localTicket'));
  const fetchImpl = async (_url, init) => {
    const d = (JSON.parse(init.body).data) || {};
    const r = await runLocalTicket({ admin: true, op: String(d.op || ''), data: d, deps: { store, readFeedbackRaw: async () => ({ fiducia: 'fidato' }) } });
    return { ok: true, status: 200, json: async () => ({ result: r }) };
  };
  return { fetchImpl, idToken: async () => 'token-finto', url: 'http://finto/localTicket', commitDelRamo: () => [] };
}

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

// Il repo dell'owner: checkout principale e due worktree, come le sessioni dell'app desktop.
function repo(dir) {
  const p = join(dir, 'principale');
  execFileSync('git', ['init', '-q', '-b', 'main', p]);
  writeFileSync(join(p, 'a.txt'), 'a\n');
  git(p, 'add', '-A');
  git(p, '-c', 'user.name=v', '-c', 'user.email=v@x', 'commit', '-qm', 'base');
  git(p, 'worktree', 'add', '-q', join(p, '.claude', 'worktrees', 'lavoro'), '-b', 'claude/lavoro');
  git(p, 'worktree', 'add', '-q', join(p, '.claude', 'worktrees', 'altro'), '-b', 'claude/altro');
  return { p, lavoro: join(p, '.claude', 'worktrees', 'lavoro'), altro: join(p, '.claude', 'worktrees', 'altro') };
}

async function lib() {
  return import(pathToFileURL(join(RADICE, 'scripts', 'lib', 'biglietto-locale.mjs')).href);
}

test('r1 una sessione pulita che registra il suo ramo da PowerShell lo registra col suo biglietto, non con quello sporco di una sessione finita ieri', async () => {
  test.skip(!SRV, 'checkout del server non trovato accanto al repo');
  const B = await lib();
  const deps = server();
  const dir = cartellaTemporanea('giro9-r1-');
  try {
    const r = repo(dir);
    // Ieri: la sessione Z legge una pagina web, lo dichiara e finisce; il suo file resta nella cartella.
    const z = await B.prendi({ sessionId: 'sess-z', cwd: r.p, deps });
    await B.sporca('ieri: letta una pagina web', { env: { FILO_BIGLIETTO_FILE: z.path }, cwd: r.p, deps });
    // Oggi: la sessione B nasce pulita nel suo worktree e non legge niente da fuori.
    const b = await B.prendi({ sessionId: 'sess-b', cwd: r.altro, deps });
    expect(b.fiducia).toBe('fidato');
    // Chiude il lavoro con un comando PowerShell: riceve l'identità della sessione, non il percorso del biglietto.
    const sha = git(r.altro, 'rev-parse', 'HEAD');
    const esito = await B.registraRamo({ repo: 'app', ramo: 'claude/altro', sha, cartella: r.altro, env: { CLAUDE_CODE_SESSION_ID: 'sess-b' }, cwd: r.altro, deps });
    expect(esito.ok).toBe(true);
    expect(esito.ramoFidato, 'la sessione è pulita: il suo ramo non può prendere la sporcizia di una sessione finita ieri').toBe(true);
    // E la stessa sessione, tornata a Bash con la sua variabile, resta pulita.
    const dopo = await B.trovaBiglietto({ env: { FILO_BIGLIETTO_FILE: b.path }, cwd: r.altro, deps });
    expect(dopo.fiducia, 'una registrazione da PowerShell non deve sporcare la sessione pulita').toBe('fidato');
  } finally {
    togliCartella(dir);
  }
});

test('r1 una sessione che si dichiara sporca da PowerShell sporca sé stessa, non le altre sessioni aperte', async () => {
  test.skip(!SRV, 'checkout del server non trovato accanto al repo');
  const B = await lib();
  const deps = server();
  const dir = cartellaTemporanea('giro9-r1-');
  try {
    const r = repo(dir);
    const a = await B.prendi({ sessionId: 'sess-a', cwd: r.lavoro, deps });
    const c = await B.prendi({ sessionId: 'sess-c', cwd: r.altro, deps });
    // A legge una pagina web e, come le dice la riga dell'avvio, lo dichiara da PowerShell.
    const s = await B.sporca('A: letta una pagina web', { env: { CLAUDE_CODE_SESSION_ID: 'sess-a' }, cwd: r.lavoro, deps });
    expect(s.sporcati).toBeGreaterThan(0);
    const statoA = await B.trovaBiglietto({ env: { FILO_BIGLIETTO_FILE: a.path }, cwd: r.lavoro, deps });
    expect(statoA.fiducia).toBe('non_fidato');
    // C non ha letto niente: deve restare pulita.
    const statoC = await B.trovaBiglietto({ env: { FILO_BIGLIETTO_FILE: c.path }, cwd: r.altro, deps });
    expect(statoC.fiducia, 'C non ha letto niente da fuori: la dichiarazione di A non può sporcarla per sempre').toBe('fidato');
  } finally {
    togliCartella(dir);
  }
});
