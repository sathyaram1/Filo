// Giro locale bozze-fuori, giro 1, rilievo 1: nel repo pubblico non resta una versione superata della politica sui modelli.
// La versione pubblicata e' transparency/models.md; quella senza numero di versione in radice e' piu' vecchia della 1.2.

import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const radice = join(import.meta.dirname, '..', '..', '..');

test('r1 la politica sui modelli in radice, se c\'e\', non e\' una versione superata', () => {
  const pubblicata = readFileSync(join(radice, 'transparency', 'models.md'), 'utf8');
  expect(pubblicata).toMatch(/modelli stretti/);
  const vecchia = join(radice, 'filo-model-policy.md');
  if (!existsSync(vecchia)) return;
  const testo = readFileSync(vecchia, 'utf8');
  expect(testo, 'la copia in radice non ha la terza categoria della politica di oggi').toMatch(/modelli stretti/);
});

test('r1 la guida alla sicurezza rimanda alla politica pubblicata, non a una versione superata', () => {
  const sicurezza = readFileSync(join(radice, 'SECURITY.md'), 'utf8');
  const rimandi = [...sicurezza.matchAll(/`([^`]*model[^`]*\.md)`/g)].map(m => m[1]);
  for (const r of rimandi) {
    const file = join(radice, r);
    expect(existsSync(file), `rimando a ${r} che non esiste`).toBe(true);
    expect(readFileSync(file, 'utf8'), `il rimando ${r} porta a una versione superata`).toMatch(/modelli stretti/);
  }
});
