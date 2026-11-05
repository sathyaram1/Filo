// Verifica #2185 giro 1: chi scrive «aspetta» senza il biglietto deve sentirsi dire come si usa, non ricevere un
// elenco di comandi in cui «aspetta» non c'è.
import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 «aspetta» senza biglietto spiega l’uso di aspetta', () => {
  const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'routine-channel.mjs'), 'aspetta'], {
    cwd: REPO, encoding: 'utf8', env: { ...process.env, FILO_ASPETTA_FETTA_MS: '0' }, timeout: 30000,
  });
  expect(r.status).not.toBe(0);
  expect(`${r.stdout}${r.stderr}`).toMatch(/aspetta/);
});
