// Le prove che lanciano gli strumenti delle routine danno lo stesso esito dal lanciatore e lanciate da sole dentro una
// routine, dove l'identità della sessione non la toglie nessuno (#849.2). La regola: tests/helpers/sessione.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Misurabile: un turno col suo consumo, che finirebbe nei corpi confrontati e nelle cartelle di prova.
function sessioneDiRoutine(casa) {
  const transcript = join(casa, 'sessione-finta.jsonl');
  const turno = { type: 'assistant', message: { id: 'msg_1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5 } } };
  writeFileSync(transcript, `${JSON.stringify(turno)}\n`, 'utf8');
  const { NODE_TEST_CONTEXT: _figlio, ...env } = process.env;
  return { ...env, FILO_ROUTINE: '1', FILO_TRANSCRIPT: transcript, FILO_SESSION_ID: 'sessione-finta' };
}

for (const [file, prove] of [
  ['routineChannelRilascio.test.mjs', 'release da riga di comando'],
  ['domandaChiusura.test.mjs', '^CLI: '],
]) {
  test(`${file} lanciato da solo dentro una routine: le prove della riga di comando non vedono la sessione`, () => {
    const casa = cartellaTemporanea('filo-prove-in-sessione-');
    try {
      const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=${prove}`, `tests/unit/${file}`],
        { cwd: REPO, env: sessioneDiRoutine(casa), encoding: 'utf8', timeout: 120_000 });
      assert.equal(r.status, 0, `${r.stdout.slice(-4000)}\n${r.stderr.slice(-2000)}`);
      assert.match(r.stdout, /^# pass [1-9]/m, 'le prove sono partite davvero');
      assert.match(r.stdout, /^# fail 0$/m);
    } finally {
      togliCartella(casa);
    }
  });
}
