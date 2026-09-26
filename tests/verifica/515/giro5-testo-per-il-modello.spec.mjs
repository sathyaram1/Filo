// Verifica #515 — giro 5.
//
// Il documento sui modelli adesso arriva al modello per intero, fonti comprese.
// Qui si guarda COME arriva: cosa gli si dice che c'è dentro prima che lo apra,
// e se il testo che deve citare è testo o markup.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);
require(join(ROOT, 'src', 'shared', 'transparency.js'));
require(join(ROOT, 'src', 'shared', 'actionTools.js'));
const T = globalThis.SN_TRANSPARENCY;

test('il testo che il modello deve citare è testo, non markup', () => {
  const guai = [];
  for (const d of T.all()) {
    const entita = d.text.match(/&(quot|amp|lt|gt|#\d+|#x[0-9a-f]+|nbsp|apos);/gi) || [];
    if (entita.length) guai.push(`${d.id}: ${entita.length} entità HTML (${[...new Set(entita)].join(' ')})`);
  }
  expect(guai, 'il modello cita le fonti con &quot; al posto delle virgolette').toEqual([]);
});

test('prima di aprirlo, il modello sa che il documento sui modelli risponde anche sui dati', () => {
  const defs = globalThis.SN_ACTION_TOOLS.definitions({});
  const tool = defs.find((d) => d.function && d.function.name === 'LEGGI_TRASPARENZA');
  const desc = tool.function.description;
  const presentazione = desc.split('sono gli unici che esistono:')[1] || '';
  const doc = T.get('models');
  test.skip(!doc, 'il documento sui modelli non c\'è');
  // Una qualunque indicazione di cosa c'è dentro: i titoli delle sezioni, o il
  // tema dei dati che la domanda della segnalazione pone.
  const diceCosaCe = /dati/i.test(presentazione)
    || doc.sections.some((s) => presentazione.includes(s.title));
  expect(diceCosaCe, `il modello legge solo: ${presentazione.trim()}`).toBe(true);
});
