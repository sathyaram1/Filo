// Giro 1 di #1959.1: fuori dai ruoli restano descrizioni al presente del fermo di prima (il giro che si ferma, il
// periodo di rispetto fra i freni del pacemaker), in parole che la sentinella del lavoro non riconosce.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const piatto = (f) => readFileSync(join(ROOT, f), 'utf8').replace(/\/\/|\*/g, ' ').replace(/\s+/g, ' ');

test('r2 i freni del pacemaker non contano più un guasto dichiarato col suo periodo di rispetto', () => {
  expect(piatto('ROUTINE-AUTH-SPEC.md')).not.toMatch(/nessun guasto è stato dichiarato \(periodo di rispetto/);
});

test('r2 il canale non descrive più il guasto come il giro che si ferma', () => {
  const t = piatto('scripts/routine-channel.mjs');
  expect(t).not.toMatch(/il giro si deve fermare/);
  expect(t).not.toMatch(/questo giro non può lavorare/);
});
