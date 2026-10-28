// Giro 7, rilievo 1: l'aiuto per impostare la domanda di fine turno elenca ogni ruolo che il server accetta.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

test('r1 l’aiuto della domanda di fine turno nomina il ruolo della risposta', () => {
  const r = spawnSync(process.execPath, [path.join('scripts', 'routine-domanda.mjs'), 'aiuto'], { encoding: 'utf8' });
  const uscita = `${r.stdout}${r.stderr}`;
  const riga = uscita.split('\n').find((l) => l.startsWith('slot:')) || '';
  expect(riga.split(/[ ,]+/)).toContain('risposta');
});
