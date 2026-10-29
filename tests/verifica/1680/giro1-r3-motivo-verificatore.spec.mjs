// #1680 giro 1, rilievo 3: il verificatore che corregge i propri rilievi consegna come gli dice il server (senza
// --motivo, che il server chiede solo al correttore), e lo strumento non deve respingerlo per il motivo mancante.
// Gira in un clone usa e getta senza biglietto: anche a correzione fatta la consegna si ferma prima del server.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

test('r3 la correzione del verificatore senza --motivo non è respinta per il motivo', () => {
  test.setTimeout(180_000);
  const base = cartellaTemporanea('filo-1680-r3-');
  const clone = join(base, 'clone');
  execFileSync('git', ['clone', '--shared', '--quiet', ROOT, clone], { stdio: 'ignore' });
  mkdirSync(join(clone, '.claude'), { recursive: true });
  writeFileSync(join(clone, '.claude', 'routine-role.json'), JSON.stringify({ role: 'verifier', since: new Date().toISOString() }));
  const stato = join(base, 'stato');
  mkdirSync(stato, { recursive: true });
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/TICKET|BIGLIETTO|FILO_ROUTINE/i.test(k)));
  env.FILO_DISPATCH_STATE_DIR = stato;
  const report = 'Corretti i due rilievi della critica: il salvataggio parte anche col titolo vuoto e la scorciatoia fa lo stesso.';
  const r = spawnSync(process.execPath, [join(clone, 'scripts', 'dispatch.mjs'), '--record-fixed', 'IdFintoDellaProva1680', report, '--frase', 'Ora salva anche senza titolo.'], {
    cwd: clone, env, encoding: 'utf8', timeout: 120_000,
  });
  expect(`${r.stdout}\n${r.stderr}`).not.toContain('Manca il motivo della correzione');
});
