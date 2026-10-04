// Verifica #951, giro 3, rilievo 1: il documento sulla sicurezza dice che le modifiche alle aree sensibili si sbloccano
// solo con un clic nell'app e mai da terminale, ma la pre-approvazione e il lavoro locale passano dal terminale.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const leggi = (rel) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8');
const unaRiga = (s) => s.replace(/\s+/g, ' ');

test('se uno strumento da terminale fa fondere modifiche alle aree sensibili, il documento non dice che nessuno lo fa', () => {
  const owner = leggi('scripts/owner-feedback.mjs');
  const fusione = leggi('scripts/lib/owner-merge.mjs');
  const daTerminale = /--preapprova/.test(owner) || /L5 saltato/.test(fusione);
  test.skip(!daTerminale, 'nessuno strumento da terminale fa più saltare il controllo umano');
  const sicurezza = unaRiga(leggi('transparency/security.md'));
  expect(sicurezza).not.toContain('Nessuno strumento da terminale lo fa');
});
