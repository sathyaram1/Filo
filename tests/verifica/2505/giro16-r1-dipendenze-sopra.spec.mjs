// #2505 giro 16: la prova dei test nuovi lanciata da un clone che prende le dipendenze dalla cartella sopra (un worktree
// locale, la copia staccata del controllo) deve trovarle anche nelle sue due copie, come le trova node risalendo.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { apriCopia } from '../../../scripts/lib/prova-test-nuovi.mjs';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

test('r1 con le dipendenze nella cartella sopra il clone, le copie della prova trovano Playwright', () => {
  const padre = cartellaTemporanea('giro16-r1-');
  const ramo = join(padre, 'ramo');
  symlinkSync(join(RADICE, 'node_modules'), join(padre, 'node_modules'), 'junction');
  execFileSync('git', ['worktree', 'add', '-q', '--detach', ramo, 'HEAD'], { cwd: RADICE });
  let copia = null;
  try {
    // Dal clone stesso node le trova risalendo: è la situazione di partenza.
    expect(() => createRequire(join(ramo, 'x.js')).resolve('@playwright/test')).not.toThrow();
    copia = apriCopia(ramo, 'HEAD');
    expect(() => createRequire(join(copia.dir, 'x.js')).resolve('@playwright/test')).not.toThrow();
  } finally {
    if (copia) copia.chiudi();
    try { execFileSync('git', ['worktree', 'remove', '--force', ramo], { cwd: RADICE }); } catch (_) { /* sotto */ }
    togliCartella(padre);
  }
});
