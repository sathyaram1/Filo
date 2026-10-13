// Un figlio lanciato da un test non misura la sessione che lancia i test (#1141.1): né da FILO_ROUTINE ereditato né dal
// biglietto in cartella. La sessione qui è finta e dichiarata; senza ambienteSenzaSessione il consumo finirebbe nel corpo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { ambienteSenzaSessione, NESSUN_TRANSCRIPT } from '../helpers/sessioneIsolata.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CANALE = resolve(ROOT, 'scripts', 'routine-channel.mjs');
const { IDENTITA_SESSIONE } = await import('../../scripts/run-unit-tests.mjs');
const { slugProgetto } = await import('../../scripts/session-report.mjs');
const TK = 'bigliettodiprova0123';

const fatte = [];
test.after(() => { for (const d of fatte) { try { togliCartella(d); } catch (_) { /* già tolta */ } } });

test('via l\'identità della sessione, un transcript dichiarato che non c\'è, e il resto dell\'ambiente resta', () => {
  const vera = { PATH: '/bin', FILO_ROUTINE_API: 'http://x', FILO_USER_DATA: '/dati' };
  for (const k of IDENTITA_SESSIONE) vera[k] = 'valore-vero';
  const e = ambienteSenzaSessione(vera);
  for (const k of IDENTITA_SESSIONE.filter((x) => x !== 'FILO_TRANSCRIPT')) assert.equal(k in e, false, k);
  assert.equal(e.FILO_TRANSCRIPT, NESSUN_TRANSCRIPT);
  assert.equal(existsSync(NESSUN_TRANSCRIPT), false);
  assert.deepEqual([e.PATH, e.FILO_ROUTINE_API, e.FILO_USER_DATA], ['/bin', 'http://x', '/dati']);
  assert.equal(vera.FILO_ROUTINE, 'valore-vero', 'l\'ambiente di partenza non si tocca');
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
      const vera = { ...ambienteSenzaSessione(), CLAUDE_CONFIG_DIR: config, FILO_REPO_ROOT: lavoro, FILO_ROUTINE_API: `http://127.0.0.1:${port}` };
      delete vera.FILO_TRANSCRIPT;
      if (routine) vera.FILO_ROUTINE = '1';
      const nuda = await risposta(vera, lavoro);
      assert.equal(nuda.status, 0, nuda.stderr);
      assert.equal(corpi[0].consumo && corpi[0].consumo.sessionId, 'sessione-vera', 'la sessione finta si fa misurare: la prova sotto vale');
      const isolata = await risposta(ambienteSenzaSessione(vera), lavoro);
      assert.equal(isolata.status, 0, isolata.stderr);
      assert.deepEqual(corpi[1], { ticket: TK, op: 'answer', answer: 'niente' });
    } finally { srv.close(); }
  });
}
