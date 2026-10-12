// #849 giro 7 — l'elenco dei servizi esterni deve dire tutte le occasioni di un servizio, e il documento sulla privacy,
// che si dice completo, deve raccontare ogni contatto che l'elenco conosce.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);
require('../../../src/shared/serviziEsterni.js');
const SE = globalThis.SN_SERVIZI_ESTERNI;

test('r1 ogni parte della home che mostra icone dal servizio di Google è nella voce di quel servizio', () => {
  const voce = SE.SERVIZI.find((v) => v.id === 'icone-google');
  const cartella = join(ROOT, 'src', 'pages', 'dashboard');
  const usano = readdirSync(cartella).filter((f) => f.endsWith('.js'))
    .filter((f) => /\bfaviconUrl\s*\(/.test(readFileSync(join(cartella, f), 'utf8')))
    .map((f) => `src/pages/dashboard/${f}`);
  // I collegamenti che Filo apre dalla chat mostrano l'icona chiesta a Google col nome del sito.
  expect(usano).toContain('src/pages/dashboard/dashboard-attivita.js');
  for (const f of usano) expect(voce.dove, f).toContain(f);
});

test('r2 ogni contatto che l\'elenco dichiara ha la sua frase nel documento sulla privacy', () => {
  const privacy = readFileSync(join(ROOT, 'transparency', 'privacy.md'), 'utf8').replace(/\s+/g, ' ');
  const senza = SE.SERVIZI.filter((v) => ![].concat(v.frase || []).some((f) => privacy.includes(f))).map((v) => v.id);
  expect(senza).toEqual([]);
});
