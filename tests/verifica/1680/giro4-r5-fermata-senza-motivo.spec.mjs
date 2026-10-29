// #1680 giro 4, rilievo 5: il correttore che si ferma con una segnalazione per l'owner consegna come vuole il server,
// per cui una fermata vale come motivo: lo strumento non deve respingerlo per il motivo mancante.
// Gira in un clone usa e getta senza biglietto: la consegna si ferma comunque prima del server.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

test('r5 la fermata del correttore senza --motivo non è respinta per il motivo', () => {
  test.setTimeout(180_000);
  const base = cartellaTemporanea('filo-1680-g4r5-');
  const clone = join(base, 'clone');
  execFileSync('git', ['clone', '--shared', '--quiet', ROOT, clone], { stdio: 'ignore' });
  mkdirSync(join(clone, '.claude'), { recursive: true });
  writeFileSync(join(clone, '.claude', 'routine-role.json'), JSON.stringify({ role: 'fixer', since: new Date().toISOString() }));
  const segnala = join(base, 'segnala.md');
  writeFileSync(segnala, '## Problema\nServe una scelta dell\'owner sul colore del bordo.\n\n## Scelte\nCaldo o freddo.\n\n## Cosa ho fatto nel frattempo\nNiente.\n');
  const stato = join(base, 'stato');
  mkdirSync(stato, { recursive: true });
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/TICKET|BIGLIETTO|FILO_ROUTINE/i.test(k)));
  env.FILO_DISPATCH_STATE_DIR = stato;
  const report = 'Mi fermo: il colore del bordo è una scelta di gusto, la chiedo all\'owner prima di correggere.';
  const r = spawnSync(process.execPath, [join(clone, 'scripts', 'dispatch.mjs'), '--record-fixed', 'IdFintoDellaProva1680', report, '--ferma', '--segnala', segnala], {
    cwd: clone, env, encoding: 'utf8', timeout: 120_000,
  });
  expect(`${r.stdout}\n${r.stderr}`).not.toContain('Manca il motivo della correzione');
});
