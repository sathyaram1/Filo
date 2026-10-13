// Le prove dei moduli che misurano la sessione non vedono la sessione che le lancia, comunque siano lanciate: il
// lanciatore toglie la sua identità (#949.1), tests/helpers/senzaSessione.mjs la toglie a un `node --test` diretto (#1071.6).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { IDENTITA_SESSIONE } from '../../scripts/run-unit-tests.mjs';

const QUI = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(QUI, '..', '..');
// Canale, rapporto di fine sessione e consumo: chi li prova li fa leggere l'identità dall'ambiente, suo o dei figli.
const MISURANO = /routine-channel\.mjs|session-report\.mjs|consumo-progressivo\.mjs/;
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
