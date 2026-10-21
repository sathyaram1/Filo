// Le prove dei moduli che misurano la sessione non vedono la sessione che le lancia, comunque siano lanciate: il
// lanciatore toglie la sua identità (#949.1), tests/helpers/senzaSessione.mjs la toglie a un `node --test` diretto (#1071.6)
// e tests/helpers/sessione.mjs ai figli che le prove lanciano (#1141.1).
import '../helpers/senzaSessione.mjs';
import { senzaSessione, NESSUN_TRANSCRIPT } from '../helpers/sessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { IDENTITA_SESSIONE } from '../../scripts/run-unit-tests.mjs';
import { slugProgetto } from '../../scripts/session-report.mjs';

const QUI = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(QUI, '..', '..');
// Canale, rapporto di fine sessione e consumo: chi li prova li fa leggere l'identità dall'ambiente, suo o dei figli.
const MISURANO = /routine-channel\.mjs|session-report\.mjs|consumo-progressivo\.mjs/;
const CANALE = resolve(ROOT, 'scripts', 'routine-channel.mjs');
const TK = 'bigliettodiprova0123';
const IMPORTA = /^import '\.\.\/helpers\/senzaSessione\.mjs';$/m;

test('chi prova i moduli che misurano la sessione importa senzaSessione', () => {
  const testo = (f) => readFileSync(join(QUI, f), 'utf8');
  const toccano = readdirSync(QUI).filter((f) => f.endsWith('.test.mjs') && MISURANO.test(testo(f)));
  for (const noto of ['domandaChiusura.test.mjs', 'routineChannelRilascio.test.mjs', 'sessionReport.test.mjs', 'esitoPerCommit.test.mjs']) {
    assert.ok(toccano.includes(noto), `${noto}: la ricerca non riconosce più chi prova quei moduli`);
  }
  assert.deepEqual(toccano.filter((f) => !IMPORTA.test(testo(f))), []);
});

function nodeTest(args, sessione) {
  // Con NODE_TEST_CONTEXT il figlio si crede una sotto-prova e non lancia i file.
  const { NODE_TEST_CONTEXT: _figlio, ...env } = process.env;
  return new Promise((ok) => {
    const p = spawn(process.execPath, ['--test', '--test-reporter=tap', ...args], { cwd: ROOT, env: { ...env, ...sessione } });
    let out = '';
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { out += c; });
    p.on('close', (code) => ok({ code, out }));
  });
}

test('dentro una routine, con node --test diretto: domanda, risposta e rilascio da riga di comando restano verdi', async () => {
  const casa = cartellaTemporanea('prove-senza-sessione-');
  try {
    const transcript = join(casa, 'sessione-vera.jsonl');
    const uso = { input_tokens: 5, cache_read_input_tokens: 40000, cache_creation_input_tokens: 2000, output_tokens: 700 };
    writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: uso, content: [] } })}\n`);
    const sessione = {
      FILO_ROUTINE: '1', FILO_ROUTINE_TICKET: 'biglietto-della-sessione', FILO_ROUTINE_ROLE: 'verifier',
      FILO_TRANSCRIPT: transcript, FILO_SESSION_ID: 'sessione-vera',
    };
    assert.deepEqual(Object.keys(sessione).sort(), [...IDENTITA_SESSIONE].sort(), 'la sessione finta ha tutta l\'identità che il lanciatore toglie');
    const r = await nodeTest([
      '--test-name-pattern=routineClosing col corpo giusto|risposta da stdin col biglietto|release da riga di comando',
      'tests/unit/domandaChiusura.test.mjs', 'tests/unit/routineChannelRilascio.test.mjs',
    ], sessione);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^ok \d+ - domanda: va a routineClosing col corpo giusto/m);
    assert.match(r.out, /^ok \d+ - CLI: risposta da stdin col biglietto/m);
    assert.match(r.out, /^ok \d+ - release da riga di comando$/m);
    assert.match(r.out, /^\s+ok \d+ - --senza-push e --senza-rapporto: rilascio nudo/m);
  } finally {
    togliCartella(casa);
  }
});

// ─── i figli lanciati da una prova (#1141.1) ─────────────────────────────────

const fatte = [];
test.after(() => { for (const d of fatte) { try { togliCartella(d); } catch (_) { /* già tolta */ } } });

test('via l\'identità della sessione, un transcript dichiarato che non c\'è, e il resto dell\'ambiente resta', () => {
  const vera = { PATH: '/bin', FILO_ROUTINE_API: 'http://x', FILO_USER_DATA: '/dati' };
  for (const k of IDENTITA_SESSIONE) vera[k] = 'valore-vero';
  const e = senzaSessione(vera);
  for (const k of IDENTITA_SESSIONE.filter((x) => x !== 'FILO_TRANSCRIPT')) assert.equal(k in e, false, k);
  assert.equal(e.FILO_TRANSCRIPT, NESSUN_TRANSCRIPT);
  assert.equal(existsSync(NESSUN_TRANSCRIPT), false);
  assert.deepEqual([e.PATH, e.FILO_ROUTINE_API, e.FILO_USER_DATA], ['/bin', 'http://x', '/dati']);
  assert.equal(vera.FILO_ROUTINE, 'valore-vero', 'l\'ambiente di partenza non si tocca');
});

test('il transcript dichiarato e assente vive in un aiuto solo', () => {
  const AIUTI = resolve(QUI, '..', 'helpers');
  const conRegola = readdirSync(AIUTI).filter((f) => f.endsWith('.mjs') && /transcript-che-non-esiste/.test(readFileSync(join(AIUTI, f), 'utf8')));
  assert.deepEqual(conRegola, ['sessione.mjs']);
});

/** Una sessione di routine finta: il suo transcript sta dove il ripiego del «più recente» lo trova, dalla cartella del figlio. */
function sessioneFinta({ biglietto }) {
  const base = cartellaTemporanea('filo-sessione-finta-');
  fatte.push(base);
  const lavoro = join(base, 'lavoro');
  const config = join(base, 'config');
  const progetto = join(config, 'projects', slugProgetto(lavoro));
  mkdirSync(join(lavoro, '.claude'), { recursive: true });
  mkdirSync(progetto, { recursive: true });
  const riga = (id) => JSON.stringify({ type: 'assistant', sessionId: 'sessione-vera', timestamp: '2026-10-12T06:00:00.000Z',
    message: { id, model: 'claude-opus-4-1', usage: { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 100, output_tokens: 50 } } });
  writeFileSync(join(progetto, 'sessione-vera.jsonl'), `${riga('m1')}\n${riga('m2')}\n`, 'utf8');
  if (biglietto) writeFileSync(join(lavoro, '.claude', 'routine-ticket.json'), JSON.stringify({ ticket: TK, since: '2026-10-12T06:00:00.000Z' }), 'utf8');
  return { lavoro, config };
}

function fintoServer() {
  const corpi = [];
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { corpi.push(JSON.parse(body || '{}')); res.end(JSON.stringify({ ok: true })); });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, corpi, port: srv.address().port })));
}

function risposta(env, cwd) {
  return new Promise((risolvi) => {
    const p = spawn(process.execPath, [CANALE, 'risposta', '--biglietto', TK], { env, cwd });
    let stderr = '';
    p.stderr.on('data', (c) => { stderr += c; });
    p.on('close', (status) => risolvi({ status, stderr }));
    p.stdin.end('niente\n');
  });
}

for (const [porta, routine] of [['FILO_ROUTINE ereditato', true], ['il biglietto in cartella', false]]) {
  test(`${porta}: il corpo della risposta di fine sessione porta solo quello che il test ha messo`, async () => {
    const { lavoro, config } = sessioneFinta({ biglietto: !routine });
    const { srv, corpi, port } = await fintoServer();
    try {
      const vera = { ...senzaSessione(), CLAUDE_CONFIG_DIR: config, FILO_REPO_ROOT: lavoro, FILO_ROUTINE_API: `http://127.0.0.1:${port}` };
      delete vera.FILO_TRANSCRIPT;
      if (routine) vera.FILO_ROUTINE = '1';
      const nuda = await risposta(vera, lavoro);
      assert.equal(nuda.status, 0, nuda.stderr);
      assert.equal(corpi[0].consumo && corpi[0].consumo.sessionId, 'sessione-vera', 'la sessione finta si fa misurare: la prova sotto vale');
      const isolata = await risposta(senzaSessione(vera), lavoro);
      assert.equal(isolata.status, 0, isolata.stderr);
      assert.deepEqual(corpi[1], { ticket: TK, op: 'answer', answer: 'niente' });
    } finally { srv.close(); }
  });
}

test('col biglietto in cartella e la sessione nella cartella di Claude, chi importa senzaSessione non misura niente (#592.18)', async () => {
  const casa = cartellaTemporanea('prove-senza-sessione-ripiego-');
  try {
    const claude = join(casa, 'claude-della-sessione');
    const progetto = join(claude, 'projects', slugProgetto(ROOT));
    mkdirSync(progetto, { recursive: true });
    const turno = { type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5 } } };
    writeFileSync(join(progetto, 'sessione-vera.jsonl'), `${JSON.stringify(turno)}\n`);
    const lavoro = join(casa, 'lavoro');
    mkdirSync(join(lavoro, '.claude'), { recursive: true });
    writeFileSync(join(lavoro, '.claude', 'routine-ticket.json'), '{}');
    const prova = join(casa, 'crediti.test.mjs');
    const url = (...p) => JSON.stringify(pathToFileURL(join(ROOT, ...p)).href);
    writeFileSync(prova, [
      `import ${url('tests', 'helpers', 'senzaSessione.mjs')};`,
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      `import { misureCrediti } from ${url('scripts', 'routine-channel.mjs')};`,
      `test('crediti', () => { assert.deepEqual(misureCrediti({ root: ${JSON.stringify(lavoro)} }), {}); });`,
    ].join('\n'));
    // Senza transcript dichiarato il ripiego c'è comunque: il biglietto in cartella basta (il caso del contenitore).
    const r = await nodeTest([prova], { FILO_ROUTINE: '1', FILO_TRANSCRIPT: '', CLAUDE_CONFIG_DIR: claude });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^ok \d+ - crediti$/m);
  } finally {
    togliCartella(casa);
  }
});
