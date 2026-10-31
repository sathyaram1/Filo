// Verifica #1555, giro 1: un rilievo col `?` di livello 1 che a lavoro fermo resta a chi riprende
// non deve perdere la sua prova prima del verdetto. Logica pura, senza aprire Filo.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { proveDaToglierePrimaDelVerdetto } from '../../../scripts/lib/prove-tolte.mjs';

const require = createRequire(import.meta.url);
require('../../../src/shared/feedbackTransitions.js');
require('../../../src/shared/verifierRound.js');
const V = globalThis.SN_VERIFIER_ROUND;

const CAPS = { cap3: 10, cap2: 10, cap1: 1, cap0: 0 };

test('r1 con un 2 interno col ? nella stessa critica, la prova del 1 col ? resta: il rilievo resta al lavoro', () => {
  const critica = 'Provato.\n[2i?] Il riquadro è freddo: caldo come il resto?\n[1i?] Il bordo è grigio: più caldo?';
  const { findings } = V.parseFindings(critica);
  const esito = V.decideRound({ findings, caps: CAPS, counts: {} });
  expect(esito.stop).toBe(true);
  expect(esito.sospesi.map((f) => f.text)).toContain('Il bordo è grigio: più caldo?');
  expect(esito.derived).toHaveLength(0);
  // Il server lo lascia davanti a chi riprende: la registrazione non deve chiederne la prova fuori.
  expect(proveDaToglierePrimaDelVerdetto(['tests/verifica/1555/giro1-r2-bordo.spec.mjs'], findings)).toEqual([]);
});

test('r1 lo stesso per un vicino col ? accanto a un 3 interno col ?', () => {
  const { findings } = V.parseFindings('Provato.\n[3i?] I dati escono: si tiene?\n[2v?] Nella pagina accanto il titolo è tagliato: più corto?');
  const esito = V.decideRound({ findings, caps: CAPS, counts: {} });
  expect(esito.stop).toBe(true);
  expect(esito.sospesi).toHaveLength(1);
  expect(proveDaToglierePrimaDelVerdetto(['tests/verifica/1555/giro1-r2-titolo.spec.mjs'], findings)).toEqual([]);
});
