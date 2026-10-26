// Verifica #1153, giro 3: ogni worker delle routine deve sapere che ha la segnalazione libera. Il contratto comune è
// il testo che dispatch dà a ogni ruolo di lavoro: senza la riga sul comando, nessuno di loro lo usa.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ROLES = path.resolve('routines', 'roles');

test('r1 il contratto comune dei worker insegna il comando segnala, coi suoi usi', () => {
  const contratto = fs.readFileSync(path.join(ROLES, '_contratto-worker.md'), 'utf8');
  expect(contratto).toMatch(/routine-channel\.mjs"?\s+segnala\b/);
});
