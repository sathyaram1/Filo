// Verifica locale «fiducia» (#1148), giro 8, rilievo 1: il biglietto lo trova solo chi ha la variabile o sta nella
// cartella dove l'hook l'ha scritto; da un worktree, senza la variabile (PowerShell non la riceve: è un percorso), la
// dichiarazione di sporco si perde e la sessione resta pulita. Hook di avvio e strumenti veri, server vero in memoria.
import { test, expect } from './../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import * as B from '../../../scripts/lib/biglietto-locale.mjs';

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

// La callable localTicket del ramo server, su Firestore in memoria, dietro il fetch che gli strumenti usano.
function serverFinto() {
  const require = createRequire(join(SRV, 'index.js'));
  const { memFirestore } = require(join(SRV, 'test', 'fixtures', 'firestore-mem'));
  const fsMod = require(join(SRV, 'src', 'data', 'firestore'));
  const mem = memFirestore({});
  fsMod.db = () => mem();
  const store = require(join(SRV, 'src', 'routine', 'store'));
  const { runLocalTicket } = require(join(SRV, 'src', 'routine', 'localTicket'));
  const fetchImpl = async (_url, init) => {
    const d = JSON.parse(init.body).data || {};
    const result = await runLocalTicket({ admin: true, op: d.op, data: d, deps: { store, readFeedbackRaw: async () => ({ fiducia: 'fidato' }) } });
    return { ok: true, status: 200, json: async () => ({ result }) };
  };
  return { fetchImpl, idToken: async () => 'token-finto' };
}

const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// La sessione dell'owner parte nella cartella principale (l'hook prende lì il biglietto e scrive la variabile per Bash),
// poi lavora in un worktree, come chiede la convenzione del repo.
async function sessioneNelWorktree() {
  const base = cartellaTemporanea('giro8-biglietto-');
  const origin = join(base, 'origin.git');
  const principale = join(base, 'principale');
  git(base, 'init', '-q', '--bare', origin);
  git(base, 'init', '-q', '-b', 'main', principale);
  writeFileSync(join(principale, '.gitignore'), '.claude/biglietti/\n');
  git(principale, 'add', '-A');
  git(principale, 'commit', '-qm', 'base');
  git(principale, 'remote', 'add', 'origin', origin);
  git(principale, 'push', '-q', 'origin', 'main');
  git(principale, 'fetch', '-q', 'origin');
  const worktree = join(principale, '.claude', 'worktrees', 'lavoro');
  git(principale, 'worktree', 'add', '-q', worktree, '-b', 'claude/lavoro');
  const deps = serverFinto();
  const envFile = join(base, 'env-sessione.sh');
  writeFileSync(envFile, '');
  const avvio = await B.avvio({ input: { session_id: 'sess-owner', source: 'startup' }, env: { CLAUDE_ENV_FILE: envFile }, cwd: principale, deps, haCredenziale: async () => true });
  expect(avvio.riga).toMatch(/^Biglietto della sessione: pulito\./);
  const m = /FILO_BIGLIETTO_FILE='([^']+)'/.exec(readFileSync(envFile, 'utf8'));
  expect(m, 'l’hook scrive la variabile per i comandi Bash').toBeTruthy();
  return { principale, worktree, deps, conVariabile: { FILO_BIGLIETTO_FILE: m[1] } };
}

test('r1 una sessione che dichiara la lettura del web da un worktree, con un comando senza la variabile, risulta sporca', async () => {
  test.skip(!SRV, 'checkout del server non trovato accanto al repo');
  const s = await sessioneNelWorktree();
  // Il comando dell'avvio, lanciato da PowerShell nel worktree: la variabile lì non arriva.
  const dichiarata = await B.sporca('letta una pagina web', { env: {}, cwd: s.worktree, deps: s.deps });
  const b = await B.trovaBiglietto({ env: s.conVariabile, cwd: s.worktree, deps: s.deps });
  expect(b && b.fiducia, `la sessione ha dichiarato la lettura (risposta: ${JSON.stringify(dichiarata)}) e il suo biglietto è ancora pulito`).toBe('non_fidato');
});

test('r1 il ramo scritto dopo una dichiarazione persa non entra come lavoro fidato', async () => {
  test.skip(!SRV, 'checkout del server non trovato accanto al repo');
  const s = await sessioneNelWorktree();
  // La lettura di un feedback non fidato dal worktree: lo strumento prova a sporcare da sé e stampa il testo.
  const riga = await B.rigaSporco('letto #1234', ['testo non fidato'], { env: {}, cwd: s.worktree, deps: s.deps });
  writeFileSync(join(s.worktree, 'lavoro.txt'), 'scritto dopo la lettura\n');
  git(s.worktree, 'add', '-A');
  git(s.worktree, 'commit', '-qm', 'lavoro');
  const sha = git(s.worktree, 'rev-parse', 'HEAD');
  // La chiusura lanciata da Bash, che la variabile la riceve.
  const r = await B.registraRamo({ repo: 'app', ramo: 'claude/lavoro', sha, feedbackId: 'fb1', cartella: s.worktree, env: s.conVariabile, cwd: s.worktree, deps: s.deps });
  expect(r.ok).toBe(true);
  expect(r.ramoFidato, `dopo «${riga}» il lavoro risulta fidato`).toBe(false);
});
