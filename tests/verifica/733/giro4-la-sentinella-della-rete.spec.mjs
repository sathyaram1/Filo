// Giro 4 di verifica del #733: la sentinella deve diventare rossa quando un
// lavoro di piattaforma perde l'avviso anche per le strade del giro 2 (l'ultima
// rete, l'esito inghiottito). Non apre Filo: fa girare la sentinella su copie ritoccate.

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const YML = fs.readFileSync(path.join(RADICE, '.github', 'workflows', 'release.yml'), 'utf8');

/** La sentinella dell'allarme, fatta girare su un workflow ritoccato: true se diventa rossa. */
function sentinellaRossa(ritocco) {
  const casa = cartellaTemporanea('filo-733-g4-');
  try {
    for (const f of ['tests/unit/releaseSuite.test.mjs', 'scripts/release-platform-alarm.mjs', 'scripts/build-alarm.mjs']) {
      fs.mkdirSync(path.dirname(path.join(casa, f)), { recursive: true });
      fs.copyFileSync(path.join(RADICE, f), path.join(casa, f));
    }
    const nuovo = ritocco(YML);
    expect(nuovo, 'il ritocco non ha trovato il punto da cambiare').not.toBe(YML);
    fs.mkdirSync(path.join(casa, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(casa, '.github', 'workflows', 'release.yml'), nuovo);
    const r = spawnSync(process.execPath, ['--test', '--test-name-pattern', 'avviso',
      path.join(casa, 'tests', 'unit', 'releaseSuite.test.mjs')], { encoding: 'utf8' });
    return r.status !== 0;
  } finally {
    fs.rmSync(casa, { recursive: true, force: true });
  }
}

test('sul workflow vero la sentinella dell\'avviso e\' verde', () => {
  expect(sentinellaRossa((s) => s + '\n')).toBe(false);
});

test('se l\'ultima rete smette di guardare Linux, la sentinella diventa rossa', () => {
  expect(sentinellaRossa((s) => s.replace(" || needs.release-linux.outputs.allarme == 'muto'", ''))).toBe(true);
});

test('se l\'avviso di Linux si dichiara partito anche quando non e\' partito, la sentinella diventa rossa', () => {
  const i = YML.indexOf('  release-linux:');
  const prima = 'if node "$ALLARME/release-platform-alarm.mjs"; then ESITO=aperto; break; fi';
  const dopo = 'node "$ALLARME/release-platform-alarm.mjs" || true; ESITO=aperto; break';
  expect(sentinellaRossa((s) => s.slice(0, i) + s.slice(i).replace(prima, dopo))).toBe(true);
});
