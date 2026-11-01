// Verifica #1959 giro 1: il ruolo non deve descrivere una routine su claude.ai col modello Fable che il pacemaker non
// accende mai (accende le stesse routine dei worker): l'owner la creerebbe a vuoto o metterebbe Fable a tutte.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r11 il ruolo non chiede una routine col modello Fable', () => {
  const t = readFileSync(join(REPO, 'routines', 'roles', 'manutentore.md'), 'utf8').replace(/\s+/g, ' ');
  expect(t).not.toMatch(/routine su claude\.ai che il pacemaker accende per te[^.]*modello Fable/);
});
