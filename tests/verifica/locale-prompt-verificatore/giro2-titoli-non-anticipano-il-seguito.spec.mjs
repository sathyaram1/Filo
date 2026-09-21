// Prova del giro 2: i titoli dei controlli si stampano a schermo a ogni corsa,
// e chi verifica la corsa la lancia per mestiere prima di dare il verdetto. Un
// titolo che racconta come prosegue il giro glielo mette davanti senza che lo
// cerchi — ed è proprio la protezione che questo lavoro doveva costruire.
//
// Il repo ha già la sua sentinella; questa prova è la memoria del giro, perché
// la porta si è aperta una volta.

import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('nessun titolo di controllo racconta come prosegue il giro', async () => {
  const { TITOLI } = await import(new URL('../../helpers/formule-vietate.mjs', import.meta.url).href);
  const colpevoli = [];
  const cammina = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('.') && e.name !== 'node_modules') cammina(p); continue; }
      if (!/\.(test|spec)\.mjs$/.test(e.name)) continue;
      readFileSync(p, 'utf8').split('\n').forEach((riga, i) => {
        if (!/^\s*(test|it)\(/.test(riga)) return;
        if (TITOLI.some((r) => r.test(riga))) colpevoli.push(`${e.name}:${i + 1}`);
      });
    }
  };
  cammina(join(ROOT, 'tests'));
  expect(colpevoli, 'titoli da riscrivere: chi verifica li legge a ogni corsa').toEqual([]);
});
