// Verifica locale «fiducia» (#1148), giro 11, rilievo 1: un'istanza di Claude Code lanciata a mano da PowerShell dentro
// una sessione sporca nasce pulita. Modello dell'ambiente dalla documentazione di Claude Code: in ogni hook
// CLAUDE_CODE_SESSION_ID è il nome della sessione che parte (uguale al session_id dell'hook); PowerShell riceve dal file
// dell'ambiente solo le variabili senza barre. Hook di avvio vero (avvio), callable localTicket vera, Firestore in memoria.
import { test, expect } from './../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
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

function serverInMemoria() {
  const SRV = funzioniDelServer();
  const require = createRequire(join(SRV, 'index.js'));
  const { memFirestore } = require(join(SRV, 'test', 'fixtures', 'firestore-mem'));
  const fsMod = require(join(SRV, 'src', 'data', 'firestore'));
  const mem = memFirestore({});
  fsMod.db = () => mem();
  const store = require(join(SRV, 'src', 'routine', 'store'));
  const { runLocalTicket } = require(join(SRV, 'src', 'routine', 'localTicket'));
  let n = 0;
  const fetchImpl = async (_url, opts) => {
    const d = JSON.parse(opts.body).data || {};
    const result = await runLocalTicket({
      admin: true, op: String(d.op || ''), data: d,
      deps: { store, newSecret: () => `segreto-${++n}-${'x'.repeat(40)}`, readFeedbackRaw: async () => ({ fiducia: 'fidato' }) },
    });
    return { ok: true, status: 200, json: async () => ({ result }) };
  };
  return { fetchImpl, idToken: async () => 'token-finto', url: 'http://server-finto/localTicket' };
}

/** Le variabili del file dell'ambiente che un comando PowerShell riceve: quelle il cui valore non ha barre. */
function variabiliPerPowerShell(fileAmbiente) {
  const out = {};
  if (!existsSync(fileAmbiente)) return out;
  for (const riga of readFileSync(fileAmbiente, 'utf8').split(/\r?\n/)) {
    const m = /^export\s+([A-Za-z_][A-Za-z0-9_]*)=(?:'((?:[^']|'\\'')*)'|(\S*))\s*$/.exec(riga.trim());
    if (!m) continue;
    const valore = (m[2] !== undefined ? m[2].replace(/'\\''/g, "'") : m[3]) || '';
    if (!/[\\/]/.test(valore)) out[m[1]] = valore;
  }
  return out;
}

test('r1 un\'istanza di Claude Code lanciata a mano da PowerShell in una sessione sporca nasce sporca', async () => {
  test.skip(!funzioniDelServer(), 'manca il worktree del server con la callable localTicket');
  const B = await import(pathToFileURL(join(RADICE, 'scripts', 'lib', 'biglietto-locale.mjs')).href);
  const deps = serverInMemoria();
  const repo = cartellaTemporanea('giro11-r1-');
  try {
    execFileSync('git', ['init', '-q', repo]);
    const P = 'pppppppp-padre-0000-0000-000000000001';
    const K = 'kkkkkkkk-figlio-000-0000-000000000002';
    const fileAmbienteP = join(repo, 'ambiente-P.sh');

    // P nasce pulita (hook di avvio vero), legge una pagina web e si dichiara sporca da PowerShell.
    const avvioP = await B.avvio({
      input: { session_id: P, source: 'startup' },
      env: { CLAUDE_CODE_SESSION_ID: P, CLAUDE_ENV_FILE: fileAmbienteP, CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1' },
      cwd: repo, deps, haCredenziale: async () => true,
    });
    expect(avvioP.riga).toContain('pulito');
    const sp = await B.sporca('pagina web letta da P', { env: { CLAUDE_CODE_SESSION_ID: P }, cwd: repo, deps });
    expect(sp.sporcati).toBe(1);
    expect((await B.trovaBiglietto({ env: { CLAUDE_CODE_SESSION_ID: P }, cwd: repo, deps })).fiducia).toBe('non_fidato');

    // P lancia `claude` da PowerShell: il figlio eredita l'ambiente del comando PowerShell di P, e Claude Code dà al suo
    // hook il nome della sessione che parte, cioè K.
    const ambienteFiglio = Object.assign(
      { CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1' },
      variabiliPerPowerShell(fileAmbienteP),
      { CLAUDE_CODE_SESSION_ID: K, CLAUDE_ENV_FILE: join(repo, 'ambiente-K.sh') },
    );
    const avvioK = await B.avvio({ input: { session_id: K, source: 'startup' }, env: ambienteFiglio, cwd: repo, deps, haCredenziale: async () => true });
    const bK = await B.trovaBiglietto({ env: { CLAUDE_CODE_SESSION_ID: K, FILO_BIGLIETTO_FILE: avvioK.path || '' }, cwd: repo, deps });
    expect(bK && bK.fiducia, 'il figlio di una sessione sporca eredita la sporcizia: nel dubbio vale sporco').not.toBe('fidato');
    expect(avvioK.riga).not.toContain('Biglietto della sessione: pulito');
  } finally {
    togliCartella(repo);
  }
});
