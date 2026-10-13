// Verifica locale «fiducia» (#1148), giro 10, rilievo 1: l'orchestratore locale lanciato da PowerShell da una sessione
// sporca fa nascere figli puliti, perché passa il biglietto del padre solo con la variabile che PowerShell non riceve.
// Funzioni vere dell'app (avvio, sporca, envFiglio) contro la callable localTicket del ramo server su Firestore in memoria.
import { test, expect } from './../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

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

// La callable vera in memoria, con la forma di risposta di una callable https: `{ result }`.
function serverFinto() {
  const require = createRequire(join(SRV, 'index.js'));
  const { memFirestore } = require(join(SRV, 'test', 'fixtures', 'firestore-mem'));
  const fsMod = require(join(SRV, 'src', 'data', 'firestore'));
  const mem = memFirestore({});
  fsMod.db = () => mem();
  const store = require(join(SRV, 'src', 'routine', 'store'));
  const { runLocalTicket } = require(join(SRV, 'src', 'routine', 'localTicket'));
  const fetchImpl = async (_url, init) => {
    const d = (JSON.parse(init.body).data) || {};
    const result = await runLocalTicket({ admin: true, op: String(d.op || ''), data: d, deps: { store, readFeedbackRaw: async () => ({ fiducia: 'fidato' }) } });
    return { ok: true, status: 200, json: async () => ({ result }) };
  };
  return { fetchImpl, idToken: async () => 'token-finto' };
}

test('r1 un figlio dell’orchestratore lanciato da PowerShell da una sessione sporca nasce sporco', async () => {
  test.skip(!SRV, 'checkout del server non trovato accanto al repo');
  const B = await import(pathToFileURL(join(RADICE, 'scripts', 'lib', 'biglietto-locale.mjs')).href);
  const { envFiglio } = await import(pathToFileURL(join(RADICE, 'scripts', 'orchestratore-locale.mjs')).href);
  const deps = serverFinto();
  const repo = cartellaTemporanea('giro10-orchestra-');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const credenziale = async () => true;

  // La sessione P nasce pulita (hook di avvio), legge una pagina web e si dichiara sporca da PowerShell: lì non arriva
  // la variabile col percorso del biglietto, arriva il nome della sessione.
  const padre = await B.avvio({ input: { session_id: 'pppp-padre', source: 'startup' }, env: {}, cwd: repo, deps, haCredenziale: credenziale });
  expect(padre.riga).toContain('pulito');
  const daPowerShell = { CLAUDE_CODE_SESSION_ID: 'pppp-padre', CLAUDECODE: '1' };
  const s = await B.sporca('pagina web letta da P', { env: daPowerShell, cwd: repo, deps });
  expect(s.sporcati).toBe(1);
  expect(await B.fiduciaLocale({ env: daPowerShell, cwd: repo, deps })).toBe('non_fidato');

  // P lancia `npm run orchestra -- avvia` da PowerShell: il figlio riceve l'ambiente dell'orchestratore e il suo hook
  // di avvio prende il biglietto. Chi continua un lavoro sporco ne eredita la sporcizia.
  const envDelFiglio = envFiglio(daPowerShell);
  const figlio = await B.avvio({ input: { session_id: 'kkkk-figlio', source: 'startup' }, env: envDelFiglio, cwd: repo, deps, haCredenziale: credenziale });
  const fiduciaFiglio = await B.fiduciaLocale({ env: { CLAUDE_CODE_SESSION_ID: 'kkkk-figlio' }, cwd: repo, deps });
  expect(fiduciaFiglio, `il figlio di una sessione sporca è nato «${figlio.riga.slice(0, 40)}»`).toBe('non_fidato');
});
