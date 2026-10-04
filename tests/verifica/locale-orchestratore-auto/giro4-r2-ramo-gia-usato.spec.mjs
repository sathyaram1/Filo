// Giro 4, rilievo 2: due lavori in coda non finiscono sullo stesso ramo.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const orchestra = (dir, ...args) => spawnSync(process.execPath, ['scripts/orchestratore-locale.mjs', ...args], {
  encoding: 'utf8', env: { ...process.env, FILO_ORCH_DIR: dir },
});

test('aggiungi rifiuta un nome di ramo già preso da un altro lavoro in coda', async () => {
  const dir = cartellaTemporanea('orch-956-');
  orchestra(dir, 'aggiungi', '5', '--slug', 'doppio');
  orchestra(dir, 'aggiungi', '6', '--slug', 'doppio');
  orchestra(dir, 'aggiungi', '7', '--slug', 'lavoro-8');
  orchestra(dir, 'aggiungi', '8');
  const s = JSON.parse(readFileSync(join(dir, 'stato.json'), 'utf8'));
  const rami = Object.values(s.pratiche).map((p) => p.slug);
  expect(new Set(rami).size).toBe(rami.length);
});
