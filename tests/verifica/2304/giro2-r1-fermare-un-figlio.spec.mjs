// Verifica #2304 giro 2: un worker non può fermare con TaskStop un sotto-agente che ha lanciato (Claude Code risponde
// «owned by <figlio>; agent <worker> cannot stop it»): né il contratto né il rifiuto del rilascio devono indicarlo come rimedio.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 il rimedio per un sotto-agente che non serve più è uno che il worker può usare', () => {
  const contratto = readFileSync(join(RADICE, 'routines', 'roles', '_contratto-worker.md'), 'utf8');
  const canale = readFileSync(join(RADICE, 'scripts', 'routine-channel.mjs'), 'utf8');
  expect(contratto, 'il contratto dei worker').not.toMatch(/TaskStop/);
  expect(canale, 'il testo del rilascio rifiutato').not.toMatch(/con lo strumento TaskStop/);
});
