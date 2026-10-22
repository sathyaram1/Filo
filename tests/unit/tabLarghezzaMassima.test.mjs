// Sentinella di #1493: il minimo accettato per la larghezza massima delle schede è la larghezza minima della scheda
// attiva, in shell.js (MIN_ATTIVA) e in shell.css (.tab.active): sotto, l'attiva sfonderebbe il massimo scelto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
createRequire(import.meta.url)(join(ROOT, 'src', 'shared', 'themeTokens.js'));
const TT = globalThis.SN_THEME_TOKENS;

test('il minimo di tab.larghezza è la larghezza minima della scheda attiva, in shell.js e in shell.css', () => {
  const min = TT.get('tab.larghezza').min;
  const js = readFileSync(join(ROOT, 'src', 'renderer', 'shell.js'), 'utf8');
  const css = readFileSync(join(ROOT, 'src', 'renderer', 'shell.css'), 'utf8');
  assert.equal(Number((/const MIN_ATTIVA = (\d+);/.exec(js) || [])[1]), min, 'MIN_ATTIVA in shell.js');
  const attiva = (/\n\.tab\.active \{([^}]*)\}/.exec(css) || [])[1] || '';
  assert.equal(Number((/min-width:\s*(\d+)px/.exec(attiva) || [])[1]), min, 'min-width di .tab.active in shell.css');
  assert.ok(TT.validate('tab.larghezza', `${min}px`) && !TT.validate('tab.larghezza', `${min - 1}px`));
});
