// Il «primo piano» è del lancio del worker, non dei suoi comandi (#1914): il ruolo gli chiede finish:check in sottofondo,
// e un prompt che glielo vietasse metterebbe due regole che non si rispettano insieme.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leggi = (...p) => readFileSync(join(RADICE, ...p), 'utf8').replace(/\r\n/g, '\n');
const una = (s) => s.replace(/\s+/g, ' ');

test('ogni worker sa dalla sua definizione che i comandi lunghi vanno in sottofondo, qualunque cosa dica il prompt', () => {
  for (const nome of ['routine-worker', 'routine-nuovo-lavoro', 'routine-secaudit']) {
    const corpo = una(leggi('.claude', 'agents', `${nome}.md`).split(/^---$/m).slice(2).join('---'));
    assert.match(corpo, /quelli lunghi in sottofondo, anche se il prompt dice altro/, nome);
    assert.match(corpo, /il «primo piano» vale per il tuo lancio, non per i tuoi comandi/, nome);
  }
});

test('chi lancia il worker tiene il primo piano per sé: nel prompt minimo non c’è', () => {
  for (const [file, inizio] of [['orchestrator.md', 'Prompt del worker (minimo):'], ['sessione.md', 'Prompt minimo:']]) {
    const testo = leggi('routines', 'roles', file);
    const da = testo.indexOf(inizio);
    assert.ok(da >= 0, `${file}: il prompt minimo c’è ancora`);
    const prompt = testo.slice(da, testo.indexOf('\n\n', da));
    assert.doesNotMatch(prompt, /sottofondo|run_in_background|primo piano/i, file);
    assert.match(una(testo), /mai `run_in_background`[.:] È una regola del tuo lancio[^.]*nel prompt non va|mai `run_in_background`: è una regola del tuo lancio e nel prompt non va/, file);
  }
});

test('il contratto dei worker chiede i comandi lunghi in sottofondo, finish:check compreso', () => {
  const contratto = leggi('routines', 'roles', '_contratto-worker.md');
  const sezione = contratto.slice(contratto.indexOf('## Comandi lunghi'), contratto.indexOf('\n## ', contratto.indexOf('## Comandi lunghi') + 3));
  assert.match(sezione, /va in \*\*sottofondo\*\*/);
  assert.match(sezione, /npm run finish:check/);
});
