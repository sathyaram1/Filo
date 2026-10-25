// Verifica #851 giro 1, rilievo 1: la novità promette che ogni giudice riceve i feedback solo da host che non li
// conservano, ma il giudice su Claude passa da Anthropic, che li tiene fino a 30 giorni (lo dice la pagina privacy).
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('r1 la novità sui giudici non promette la ritenzione zero anche al giudice su Claude', () => {
  require('../../../src/shared/patchNotes.js');
  const note = globalThis.SN_PATCH_NOTES;
  const righe = (note.NOTES || note.notes || note.list || note)
    .flatMap((v) => [...(v.features || []), ...(v.fixes || [])])
    .filter((r) => /giudici/.test(r) && /conserv/.test(r));
  expect(righe.length).toBeGreaterThan(0);
  for (const r of righe) expect(r).toMatch(/Anthropic|Claude/);
});
