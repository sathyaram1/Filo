// Prova del giro 2 (verifica locale), rilievo 1: nessuna prova rimasta nel repo pretende ancora
// lo sforzo xhigh per i worker che la decisione ha portato a high.

import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const QUI = dirname(fileURLToPath(import.meta.url));
const VERIFICA = resolve(QUI, '..');

test('nessuna prova pretende xhigh per verifica e controllo di sicurezza', () => {
  const colpevoli = [];
  for (const cartella of readdirSync(VERIFICA)) {
    const dir = join(VERIFICA, cartella);
    if (dir === QUI || !statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.spec.mjs'))) {
      const t = readFileSync(join(dir, f), 'utf8');
      if (/routine-(worker|secaudit)/.test(t) && /effort:\\s\*xhigh/.test(t)) colpevoli.push(`${cartella}/${f}`);
    }
  }
  expect(colpevoli).toEqual([]);
});
