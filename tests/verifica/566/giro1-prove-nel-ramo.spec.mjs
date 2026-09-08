// Prova del giro 1: una spec messa dove i ruoli dicono di metterla
// (tests/verifica/<numero>/) viene davvero raccolta dalla suite e sa aprire
// Filo con le fixture del repo dalla sotto-cartella.
import { test, expect } from '../../fixtures/electron.mjs';

test('la shell di Filo si apre da una spec dentro tests/verifica/<numero>', async ({ shell }) => {
  await expect.poll(async () => shell.url()).toContain('filo');
});
