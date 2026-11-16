// Verifica #2337 giro 7, rilievo 2: il rapporto di fine sessione conta la rete chiamata dalla shell, su cui il server
// ritira la fiducia al manutentore. Forme comuni di uno scaricamento non vengono contate.
import { test, expect } from '@playwright/test';
import { chiamaLaRete } from '../../../scripts/session-report.mjs';

const COMANDI = [
  'timeout 30 curl -s https://example.com/docs',
  'LANG=C curl -s https://example.com/docs',
  'bash -c "curl -s https://example.com/docs"',
  "sh -c 'wget -qO- https://example.com/docs'",
];

test('r2 uno scaricamento dalla shell con un prefisso comune, o dentro una shell figlia, si conta come rete', () => {
  const mancati = COMANDI.filter((c) => !chiamaLaRete(c));
  expect(mancati).toEqual([]);
});
