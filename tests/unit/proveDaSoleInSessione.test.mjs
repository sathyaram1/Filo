// I file di prova che leggono la sessione restano verdi anche lanciati da soli con `node --test` dentro una sessione
// vera, routine o locale: il lanciatore degli unit toglie l'identità (#949.1), chi corre un file a mano no (#1109.1).
// La regola sta in tests/helpers/senzaSessione.mjs.

import '../helpers/senzaSessione.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDENTITA_SESSIONE } from '../../scripts/run-unit-tests.mjs';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';

const QUI = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(QUI, '..', '..');
const QUESTO = basename(fileURLToPath(import.meta.url));
// Quelli che lanciati da soli in una sessione erano rossi: se uno perde l'import del helper, la prova lo rivede rosso.
const NOTI = ['dispatch', 'domandaChiusura', 'esitoPerCommit', 'routineChannelRilascio', 'routineRole', 'routineTicket', 'sessionReport']
  .map((n) => `${n}.test.mjs`);
const IMPORTA = /^import '\.\.\/helpers\/senzaSessione\.mjs';$/m;

test('lanciati da soli in una sessione con tutta la sua identità accesa, i file che la leggono sono verdi (#1109.1)', () => {
  const importano = readdirSync(QUI).filter((f) => f.endsWith('.test.mjs') && f !== QUESTO && IMPORTA.test(readFileSync(join(QUI, f), 'utf8')));
  const file = [...new Set([...NOTI, ...importano])];
  const casa = cartellaTemporanea('filo-prove-da-sole-');
  try {
    // Un transcript con un consumo vero: è quello che finiva nei corpi confrontati e nelle cartelle di prova.
    const sid = 'sessione-che-lancia-le-prove';
    const transcript = join(casa, `${sid}.jsonl`);
    const uso = { input_tokens: 12, output_tokens: 34, cache_read_input_tokens: 5600, cache_creation_input_tokens: 78 };
    writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', message: { id: 'msg_1', model: 'claude-opus-4-8', usage: uso } })}\n`, 'utf8');
    const sessione = {
      FILO_ROUTINE: '1', FILO_ROUTINE_ROLE: 'prober', FILO_ROUTINE_TICKET: 'biglietto-della-sessione-vera',
      FILO_TRANSCRIPT: transcript, FILO_SESSION_ID: sid,
    };
    assert.deepEqual(Object.keys(sessione).sort(), [...IDENTITA_SESSIONE].sort(), 'ogni voce dell\'identità della sessione è accesa');
    // Con NODE_TEST_CONTEXT il figlio si crederebbe una sotto-prova di questa e non correrebbe niente.
    const { NODE_TEST_CONTEXT: _figlio, ...ambiente } = process.env;
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...fileArgs(file.map((f) => join(QUI, f)), ROOT)], {
      cwd: ROOT, env: { ...ambiente, ...sessione }, encoding: 'utf8', timeout: TETTO_ATTESA_MS, maxBuffer: 256 * 1024 * 1024,
    });
    const rossi = String(r.stdout || '').match(/^\s*not ok .*$/gm) || [];
    assert.equal(r.status, 0, rossi.join('\n') || String(r.stderr || r.error || '').slice(-4000));
    assert.match(String(r.stdout), /^# fail 0$/m);
  } finally {
    togliCartella(casa);
  }
});
