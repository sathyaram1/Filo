// Verifica #2571 giro 1, rilievo 3: le intestazioni dei moduli nuovi rimandano alle loro regole; il rimando deve esistere.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r3 le regole citate in testa ai moduli della memoria e della corsa esistono', () => {
  for (const f of ['scripts/lib/memoria-contenitore.mjs', 'scripts/lib/corsa-controlli.mjs']) {
    const testa = readFileSync(join(REPO, f), 'utf8').split('\n').slice(0, 3).join('\n');
    const rimandi = testa.match(/tests\/unit\/[\w.-]+\.test\.mjs/g) || [];
    expect(rimandi.length, f).toBeGreaterThan(0);
    for (const r of rimandi) expect(existsSync(join(REPO, r)), `${f} rimanda a ${r}`).toBe(true);
  }
});
