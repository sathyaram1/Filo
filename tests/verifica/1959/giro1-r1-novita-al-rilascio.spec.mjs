// Verifica #1959 giro 1: la riscrittura del redattore deve arrivare alle novità pubblicate; oggi la accetta il server e
// nessuno, al rilascio, la chiede (operazione releaseNovita) né la mette al posto delle righe dei worker.
import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 il rilascio chiede al server le novità del redattore', () => {
  const dove = [];
  for (const dir of ['.github/workflows', 'scripts', 'scripts/lib']) {
    for (const f of readdirSync(join(REPO, dir))) {
      if (!/\.(ya?ml|mjs|js)$/.test(f) || f === 'manutentore.mjs') continue;
      if (/releaseNovita/.test(readFileSync(join(REPO, dir, f), 'utf8'))) dove.push(`${dir}/${f}`);
    }
  }
  expect(dove, 'nessun passo del rilascio legge la riscrittura accettata').not.toEqual([]);
});
