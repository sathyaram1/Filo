// Il gancio delle letture esterne (#1211): quali strumenti sporcano, il gancio con uno stdin finto, il cablaggio nelle
// impostazioni del progetto. Lo sporco annotato e la sua consegna stanno in biglietto.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, collegaCartella, togliCartella } from '../helpers/percorsi.mjs';
import * as B from '../../scripts/lib/biglietto-locale.mjs';
import * as L from '../../scripts/lib/letture-esterne.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GANCIO = join(ROOT, '.claude', 'hooks', 'letture-esterne.sh');
const SEGRETO = 'g'.repeat(43);
const FP = '7'.repeat(64);

const ctxPosix = { cwd: '/casa/Filo', win: false, cartelle: ['/casa/Filo', '/casa/filo-security', '/home/o/.claude'], file: ['/casa/LOCAL.md'] };
const leggi = (file_path, ctx = ctxPosix) => L.motivoLettura({ tool_name: 'Read', tool_input: { file_path } }, ctx);

test('classificatore: la rete, le risorse MCP e ogni mcp__ fuori dall’elenco chiuso sporcano; shell, ricerche nel disco e scritture no', () => {
  assert.equal(L.motivoLettura({ tool_name: 'WebFetch', tool_input: { url: 'https://esempio.it/a?chiave=segreta' } }), 'WebFetch (esempio.it)');
  assert.equal(L.motivoLettura({ tool_name: 'WebFetch', tool_input: { url: 'non un indirizzo' } }), 'WebFetch');
  assert.equal(L.motivoLettura({ tool_name: 'WebSearch', tool_input: { query: 'x' } }), 'WebSearch');
  for (const n of ['ListMcpResourcesTool', 'ReadMcpResourceTool', 'ReadMcpResourceDirTool']) assert.equal(L.motivoLettura({ tool_name: n }), n);
  for (const n of ['mcp__github__get_file_contents', 'mcp__claude-in-chrome__get_page_text', 'mcp__plugin_posta_gmail__search', 'mcp__computer-use__screenshot']) {
    assert.equal(L.motivoLettura({ tool_name: n, tool_input: {} }), n);
  }
  for (const n of L.MCP_SENZA_LETTURA) assert.equal(L.motivoLettura({ tool_name: n }), '', n);
  for (const n of ['Bash', 'PowerShell', 'Grep', 'Glob', 'Edit', 'Write', 'NotebookEdit', 'Agent', 'TodoWrite', '', undefined]) {
    assert.equal(L.motivoLettura({ tool_name: n, tool_input: { file_path: '/etc/passwd', path: '/etc', url: 'https://x.it' } }, ctxPosix), '', String(n));
  }
  assert.equal(L.motivoLettura(null), '');
});

test('classificatore: Read sporca solo fuori dal repo, dal checkout del server accanto e dalla cartella di Claude; LOCAL.md sopra il repo no', () => {
  assert.equal(leggi('/casa/Filo/src/main/index.js'), '');
  assert.equal(leggi('/casa/Filo'), '');
  assert.equal(leggi('src/relativo.js'), '', 'relativo alla cartella della chiamata');
  assert.equal(leggi('/casa/filo-security/functions/index.js'), '');
  assert.equal(leggi('/home/o/.claude/projects/x/tool-results/1.txt'), '');
  assert.equal(leggi('/casa/LOCAL.md'), '');
  assert.equal(leggi('/casa/segnala-12.md'), 'Read fuori dal repo (segnala-12.md)');
  assert.equal(leggi('/casa/Filo-copia/x.js'), 'Read fuori dal repo (x.js)', 'stesso inizio del nome, cartella diversa');
  assert.equal(leggi('/casa/Filo/../Scaricati/fattura.pdf'), 'Read fuori dal repo (fattura.pdf)');
  assert.equal(leggi('../fuori.txt'), 'Read fuori dal repo (fuori.txt)');
  assert.equal(leggi('/altro/.claude/skills/x.md'), 'Read fuori dal repo (x.md)', 'solo la cartella di Claude dell’utente, non quella di un altro progetto');
  assert.equal(leggi('/tmp/a\nb\u0000.txt'), 'Read fuori dal repo (a b .txt)');
  assert.equal(leggi(''), '');
  // Un collegamento dentro il repo che porta fuori: conta dove sta il file vero.
  const canonico = (p) => (p.startsWith('/casa/Filo/link/') ? `/esterno/${p.slice('/casa/Filo/link/'.length)}` : p);
  assert.equal(leggi('/casa/Filo/link/x.txt', { ...ctxPosix, canonico }), 'Read fuori dal repo (x.txt)');
});

test('classificatore: su Windows maiuscole e barre non contano', () => {
  const ctx = { cwd: 'C:\\Users\\agenti AI\\Desktop\\Filo\\Filo', win: true, cartelle: ['c:\\users\\agenti ai\\desktop\\filo\\filo', 'C:\\Users\\agenti AI\\.claude'], file: ['C:\\Users\\agenti AI\\Desktop\\Filo\\LOCAL.md'] };
  assert.equal(leggi('C:\\Users\\Agenti AI\\Desktop\\Filo\\Filo\\src\\x.js', ctx), '');
  assert.equal(leggi('C:/Users/agenti AI/Desktop/Filo/Filo/package.json', ctx), '');
  assert.equal(leggi('c:\\users\\agenti ai\\desktop\\filo\\local.md', ctx), '');
  assert.equal(leggi('C:\\Users\\agenti AI\\.claude\\plans\\p.md', ctx), '');
  assert.equal(leggi('C:\\Users\\agenti AI\\Desktop\\Filo\\nota.md', ctx), 'Read fuori dal repo (nota.md)');
  assert.equal(leggi('D:\\Filo\\Filo\\x.js', ctx), 'Read fuori dal repo (x.js)');
});

test('contesto: il repo anche da una worktree, il checkout del server accanto, la cartella di Claude, LOCAL.md', () => {
  const sopra = cartellaTemporanea('letture-ctx-');
  try {
    const repo = join(sopra, 'Filo');
    mkdirSync(repo);
    const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'x.txt'), 'x');
    git('add', '-A');
    git('commit', '-qm', 'base');
    const wt = join(repo, '.claude', 'worktrees', 'lavoro');
    git('worktree', 'add', '-q', wt, '-b', 'claude/lavoro');
    mkdirSync(join(sopra, 'filo-security', 'functions', 'tools'), { recursive: true });
    writeFileSync(join(sopra, 'filo-security', 'functions', 'tools', 'server-fondi.js'), '');
    const ctx = L.contestoLettura({ cwd: wt, env: { CLAUDE_CONFIG_DIR: join(sopra, 'conf') } });
    for (const dove of [join(wt, 'src', 'a.js'), join(repo, 'x.txt'), join(sopra, 'filo-security', 'functions', 'index.js'), join(sopra, 'conf', 'x'), join(sopra, 'LOCAL.md')]) {
      assert.equal(L.motivoLettura({ tool_name: 'Read', tool_input: { file_path: dove } }, ctx), '', dove);
    }
    assert.match(L.motivoLettura({ tool_name: 'Read', tool_input: { file_path: join(sopra, 'altro.md') } }, ctx), /fuori dal repo/);
  } finally { togliCartella(sopra); }
});

function conBiglietto() {
  const dir = cartellaTemporanea('letture-');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const path = join(B.cartellaBiglietti(dir), 'sess.json');
  B.scriviFile(path, { ticket: SEGRETO, fp: FP, natoIl: 1 });
  return { dir, b: B.leggiFile(path) };
}

test('gancio: annota la lettura accanto al biglietto della sessione dello stdin e lancia la consegna senza aspettarla', () => {
  const { dir, b } = conBiglietto();
  try {
    const avviati = [];
    const avvia = (p, o) => avviati.push([p, o.motivo]);
    const input = { session_id: 'sess', cwd: dir, tool_name: 'WebFetch', tool_input: { url: 'https://esempio.it' } };
    const r = L.gancio({ input, env: {}, avvia, nowMs: 5 });
    assert.deepEqual(r, { esito: 'annotato', motivo: 'WebFetch (esempio.it)' });
    assert.deepEqual(B.sporchiInAttesa(b).map((v) => [v.motivo, v.at]), [['WebFetch (esempio.it)', 5]]);
    assert.deepEqual(avviati, [[b.path, '']]);
    assert.equal(L.gancio({ input: { ...input, session_id: 'altra' }, env: {}, avvia }).esito, 'senza biglietto', 'mai il biglietto di un’altra sessione');
    assert.equal(L.gancio({ input, env: { FILO_ROUTINE: '1' }, avvia }).esito, 'routine');
    assert.equal(L.gancio({ input: { ...input, tool_name: 'Bash' }, env: {}, avvia }).esito, 'nessuna lettura esterna');
    assert.equal(L.gancio({ input: 'storto', env: {}, avvia }).esito, 'nessuna lettura esterna');
    assert.equal(avviati.length, 1);
    // Già sporco sul server: niente annotazioni né chiamate in più.
    writeFileSync(join(B.cartellaSporchi(b), 'sul-server'), '1\n');
    L.gancio({ input, env: {}, avvia });
    assert.equal(avviati.length, 1);
    assert.equal(B.sporchiInAttesa(b).length, 1);
  } finally { togliCartella(dir); }
});

test('gancio: se non riesce ad annotare, la consegna in sottofondo porta il motivo; un guasto non lancia mai', () => {
  const { dir, b } = conBiglietto();
  try {
    writeFileSync(join(B.cartellaBiglietti(dir), 'sporchi'), 'non una cartella');
    const avviati = [];
    const r = L.gancio({ input: { session_id: 'sess', cwd: dir, tool_name: 'mcp__github__get_file_contents' }, env: {}, avvia: (p, o) => avviati.push([p, o.motivo]) });
    assert.equal(r.esito, 'annotato');
    assert.deepEqual(avviati, [[b.path, 'mcp__github__get_file_contents']]);
    assert.equal(L.gancio({ input: { session_id: 'sess', cwd: dir, tool_name: 'WebSearch' }, env: {}, avvia: () => { throw new Error('rotto'); } }).esito, 'guasto');
  } finally { togliCartella(dir); }
});

// ── Il gancio vero, con uno stdin finto ──

function lanciaGancio(input, { progetto = ROOT, env = {} } = {}) {
  const base = { ...process.env };
  for (const k of ['FILO_ROUTINE', 'CLAUDE_CODE_SESSION_ID', 'FILO_BIGLIETTO_FILE', 'CLAUDE_CONFIG_DIR']) delete base[k];
  // La consegna in sottofondo non deve mai toccare il server vero: la prova lo vieta a chiama().
  const r = spawnSync('bash', [GANCIO], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: { ...base, CLAUDE_PROJECT_DIR: progetto, NODE_TEST_CONTEXT: 'child', FILO_FUNCTIONS_BASE: 'http://127.0.0.1:9', ...env },
    encoding: 'utf8', timeout: 30000,
  });
  return r;
}

test('il gancio vero: sporca per pagine web, MCP e file fuori dal repo; per i file del repo, la shell e le routine no; esce sempre 0 e muto', (t) => {
  const { dir, b } = conBiglietto();
  const fuori = cartellaTemporanea('letture-fuori-');
  const casa = cartellaTemporanea('letture-casa-');
  try {
    const prova = (tool_name, tool_input = {}, opz = {}) => {
      rmSync(B.cartellaSporchi(b), { recursive: true, force: true });
      const r = lanciaGancio({ session_id: 'sess', cwd: dir, hook_event_name: 'PostToolUse', tool_name, tool_input, tool_response: { contenuto: 'testo "con" virgolette \\ e barre' } }, opz);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '');
      return B.sporchiInAttesa(b).map((v) => v.motivo);
    };
    assert.deepEqual(prova('WebFetch', { url: 'https://esempio.it/pagina' }), ['WebFetch (esempio.it)']);
    assert.deepEqual(prova('mcp__claude-in-chrome__get_page_text', { tabId: 1 }), ['mcp__claude-in-chrome__get_page_text']);
    assert.deepEqual(prova('Read', { file_path: join(fuori, 'mail.eml') }), ['Read fuori dal repo (mail.eml)']);
    assert.deepEqual(prova('Read', { file_path: `${ROOT}/../fuori-dal-repo.txt` }), ['Read fuori dal repo (fuori-dal-repo.txt)'], '«..» lo decide node');
    assert.deepEqual(prova('Read', { file_path: join(ROOT, 'package.json') }), [], 'dentro il progetto');
    assert.deepEqual(prova('Read', { file_path: join(dir, 'x.txt') }), [], 'dentro il repo della sessione');
    assert.deepEqual(prova('Read', { file_path: join(dirname(ROOT), 'LOCAL.md') }), []);
    assert.deepEqual(prova('Read', { file_path: join(casa, '.claude', 'plans', 'p.md') }, { env: { HOME: casa, USERPROFILE: casa } }), []);
    for (const n of ['Bash', 'Grep', 'Glob', 'mcp__ide__getDiagnostics']) assert.deepEqual(prova(n, { command: 'curl x', pattern: 'x', path: fuori }), [], n);
    assert.deepEqual(prova('WebFetch', { url: 'https://esempio.it' }, { env: { FILO_ROUTINE: '1' } }), [], 'nelle routine c’è il loro biglietto');
    const storto = lanciaGancio('{non json');
    assert.equal(storto.status, 0);
    // Un collegamento dentro il progetto che porta fuori: il salto senza processi lo lascia decidere a node.
    const progetto = cartellaTemporanea('letture-progetto-');
    try {
      mkdirSync(join(progetto, '.git'));
      collegaCartella(join(ROOT, 'scripts'), join(progetto, 'scripts'));
      collegaCartella(fuori, join(progetto, 'collegato'));
      assert.deepEqual(prova('Read', { file_path: join(progetto, 'collegato', 'mail.eml') }, { progetto }), ['Read fuori dal repo (mail.eml)']);
      assert.deepEqual(prova('Read', { file_path: join(progetto, 'vero.txt') }, { progetto }), []);
    } catch (e) {
      if (process.platform === 'win32' && e && e.code === 'EPERM') t.diagnostic('collegamento negato da Windows: parte saltata');
      else throw e;
    } finally { togliCartella(progetto); }
  } finally {
    togliCartella(dir);
    togliCartella(fuori);
    togliCartella(casa);
  }
});

test('cablaggio: il gancio sta dopo uno strumento riuscito e dopo uno fallito, su tutti e soli gli strumenti che possono leggere fuori', () => {
  const s = JSON.parse(readFileSync(join(ROOT, '.claude', 'settings.local.json'), 'utf8'));
  const possibili = ['Read', ...L.STRUMENTI_ESTERNI, 'mcp__github__get_file_contents', 'mcp__plugin_posta_gmail__search', 'mcp__claude-in-chrome__navigate'];
  for (const evento of ['PostToolUse', 'PostToolUseFailure']) {
    const voci = (s.hooks[evento] || []).filter((g) => (g.hooks || []).some((h) => /\.claude\/hooks\/letture-esterne\.sh/.test(h.command)));
    assert.equal(voci.length, 1, evento);
    // Come Claude Code: con un carattere da espressione regolare il matcher è una RegExp non ancorata.
    const re = new RegExp(voci[0].matcher);
    for (const n of possibili) assert.ok(re.test(n), `${evento}: ${n} non fa partire il gancio`);
    for (const n of possibili) assert.ok(L.puoLeggereFuori(n), n);
    for (const n of ['Bash', 'Grep', 'Glob', 'Edit', 'Write', 'Agent']) assert.equal(re.test(n), false, `${evento}: ${n} lo farebbe partire per niente`);
  }
  const src = readFileSync(GANCIO, 'utf8');
  assert.doesNotMatch(src, /\r\n/, 'fine riga LF');
  assert.match(src, /\[ -n "\$FILO_ROUTINE" \] && exit 0/);
  assert.match(src, /biglietto\.mjs" gancio/);
  assert.match(src, /exit 0\s*$/);
  assert.doesNotMatch(src, /exit [1-9]/);
  assert.match(readFileSync(join(ROOT, '.claude', 'hooks', 'session-start.sh'), 'utf8'), new RegExp(`timeout ${B.TETTO_AVVIO_MS / 1000}"`), 'la consegna in sottofondo ha il tetto dell’avvio');
});

test('la consegna in sottofondo: esce 0 da sola anche col server irraggiungibile, e lo sporco resta annotato', () => {
  const { dir, b } = conBiglietto();
  try {
    B.annotaSporco(b, 'WebSearch', 1);
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'biglietto.mjs'), 'consegna'], {
      env: { ...process.env, FILO_BIGLIETTO_FILE: b.path, NODE_TEST_CONTEXT: 'child', FILO_FUNCTIONS_BASE: 'http://127.0.0.1:9' },
      encoding: 'utf8', timeout: 30000,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(B.sporchiInAttesa(b).map((v) => v.motivo), ['WebSearch']);
    assert.equal(existsSync(join(B.cartellaSporchi(b), 'sul-server')), false);
  } finally { togliCartella(dir); }
});
