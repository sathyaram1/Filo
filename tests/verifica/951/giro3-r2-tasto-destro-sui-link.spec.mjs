// Verifica #951, giro 3, rilievo 2: il tasto destro su un collegamento contatta da solo il sito del collegamento e
// manda il collegamento a un modello; il documento sulla privacy dice «quando chiedi» e non lo elenca fra i modelli.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const leggi = (rel) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8');

test('se il tasto destro su un link chiede da solo titolo e descrizione al sito, il documento non dice «quando chiedi»', () => {
  const azioni = leggi('src/content/actions.js');
  const daSolo = /onMount[\s\S]{0,1500}fetch_link_meta/.test(azioni);
  test.skip(!daSolo, 'il tasto destro su un collegamento non contatta più il sito da solo');
  const privacy = leggi('transparency/privacy.md').replace(/\s+/g, ' ');
  expect(privacy).not.toContain('Quando chiedi cos\'è un link');
});

test('fra quello che arriva ai modelli c\'è il collegamento su cui fai tasto destro', () => {
  const azioni = leggi('src/content/actions.js');
  test.skip(!/EXPLAIN_LINK/.test(azioni), 'il tasto destro su un collegamento non chiama più un modello');
  const privacy = leggi('transparency/privacy.md');
  const modelli = privacy.split('## I modelli')[1].split('**Chi riceve questi dati.**')[0];
  const voci = modelli.split('\n').filter((r) => r.startsWith('- **'));
  expect(voci.some((v) => /link|collegament/i.test(v))).toBe(true);
});
