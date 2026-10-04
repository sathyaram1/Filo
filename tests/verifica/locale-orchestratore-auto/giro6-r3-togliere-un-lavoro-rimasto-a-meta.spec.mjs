// Giro 6, rilievo 3: un lavoro rimasto a metà da un orchestratore chiuso (riavvio, finestra chiusa) si può togliere.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const orchestra = (dir, ...args) => spawnSync(process.execPath, ['scripts/orchestratore-locale.mjs', ...args], {
  encoding: 'utf8', env: { ...process.env, FILO_ORCH_DIR: dir },
});

test('orchestratore chiuso mentre verificava: togli toglie il lavoro dalla coda', async () => {
  const dir = cartellaTemporanea('orch-956-g6-');
  orchestra(dir, 'aggiungi', '7', '--slug', 'prova-verif-g6', '--richiesta', 'una prova');
  const f = join(dir, 'stato.json');
  const s = JSON.parse(readFileSync(f, 'utf8'));
  // Come lo lascia un orchestratore interrotto a metà verifica: nessun processo vivo, fase ancora «verifica».
  Object.assign(s.pratiche[7], { fase: 'verifica', giri: 1, giriTotali: 1 });
  writeFileSync(f, JSON.stringify(s, null, 2));
  expect(orchestra(dir, 'stato').stdout).toMatch(/Orchestratore fermo/);
  const r = orchestra(dir, 'togli', '7');
  expect(r.status).toBe(0);
  expect(JSON.parse(readFileSync(f, 'utf8')).pratiche[7]).toBeUndefined();
});
