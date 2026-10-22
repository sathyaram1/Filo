// Col biglietto finito (rilasciato, o morto per il battito) il gancio di salvataggio committa ma non spedisce più, né
// col push normale né col lease: il ramo può già essere di un altro worker (#1480, D-90). Scena: tests/helpers/scenaHook.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { git, scene, runHookRaw, rigaJson, commitFile, shaOf, stdinEdit, remoto } from '../helpers/scenaHook.mjs';

const BIGLIETTO = 'b'.repeat(43);
const marcatore = (work, extra = {}) => {
  mkdirSync(resolve(work, '.claude'), { recursive: true });
  // Come nei giri veri (ensureSessionExcludes): il marcatore non finisce nei commit.
  appendFileSync(resolve(work, '.git', 'info', 'exclude'), '\n.claude/routine-ticket.json\n');
  writeFileSync(resolve(work, '.claude', 'routine-ticket.json'), JSON.stringify({ ticket: BIGLIETTO, since: new Date().toISOString(), ...extra }));
};
const MORTO = { morto: { ora: new Date().toISOString(), perche: 'dead_ticket' } };

test('biglietto morto e storia riscritta: nessun push, nemmeno col lease; il commit resta e la sessione lo sa', () => {
  const { work } = scene();
  git(work, ['checkout', '-q', '-b', 'worker/zombie']);
  commitFile(work, 'a.js');
  git(work, ['push', '-q', 'origin', 'worker/zombie']);
  const a = shaOf(work, 'worker/zombie');
  marcatore(work, MORTO);
  git(work, ['reset', '-q', '--hard', 'HEAD~1']);
  writeFileSync(resolve(work, 'b.js'), 'dopo la morte del biglietto\n', 'utf8');

  const r = runHookRaw(work, stdinEdit(resolve(work, 'b.js')), { FILO_ROUTINE: '1' });

  assert.equal(remoto(work, 'worker/zombie'), a, 'il ramo su origin resta quello di prima: niente --force-with-lease');
  assert.equal(git(work, ['status', '--porcelain']), '', 'il salvataggio locale resta');
  assert.ok(git(work, ['show', '--name-only', '--format=', 'HEAD']).split('\n').includes('b.js'));
  const ctx = JSON.parse(rigaJson(r)).hookSpecificOutput.additionalContext;
  assert.match(ctx, /biglietto di questo lavoro e' finito/);
  assert.match(ctx, /NON spedisco 'worker\/zombie'/);
});

test('biglietto morto e commit in avanti: nemmeno il push normale parte', () => {
  const { work } = scene();
  git(work, ['checkout', '-q', '-b', 'worker/zombie2']);
  commitFile(work, 'a.js');
  git(work, ['push', '-q', 'origin', 'worker/zombie2']);
  const a = shaOf(work, 'worker/zombie2');
  marcatore(work, { morto: { ora: new Date().toISOString(), perche: 'rilasciato' } });
  writeFileSync(resolve(work, 'c.js'), 'ancora\n', 'utf8');

  runHookRaw(work, stdinEdit(resolve(work, 'c.js')), { FILO_ROUTINE: '1' });

  assert.equal(remoto(work, 'worker/zombie2'), a);
  assert.notEqual(shaOf(work, 'worker/zombie2'), a, 'il commit locale c\'è');
});

test('biglietto vivo: il ramo parte come sempre', () => {
  const { work } = scene();
  git(work, ['checkout', '-q', '-b', 'worker/vivo']);
  marcatore(work);
  writeFileSync(resolve(work, 'd.js'), 'vivo\n', 'utf8');

  runHookRaw(work, stdinEdit(resolve(work, 'd.js')), { FILO_ROUTINE: '1' });

  assert.equal(remoto(work, 'worker/vivo'), shaOf(work, 'worker/vivo'));
});
