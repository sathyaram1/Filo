// #2678.13 giro 2: la frase-password seguita da una nota deve sparire anche se dopo la nota la riga continua
// senza punteggiatura, o se la nota sta in una forma meno comune (tab, parentesi larghe, graffe, lineetta lunga).
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');

test('r1 la frase-password non arriva in chiaro quando dopo la nota la riga continua', () => {
  for (const riga of [
    'Password: casa mia al mare (tutto minuscolo) grazie',
    'Password: casa mia al mare (tutto minuscolo) ciao',
    'Password: casa mia al mare (tutto minuscolo) utente mario',
    'Password: casa mia al mare (tutto minuscolo) e utente mario',
  ]) {
    expect(P.oscura(riga), riga).not.toContain('casa mia al mare');
  }
});

test('r1 la frase-password non arriva in chiaro con la nota in una forma meno comune', () => {
  for (const riga of [
    'Password: casa mia al mare\t(tutto minuscolo)',
    'Password: casa mia al mare （tutto minuscolo）',
    'Password: casa mia al mare {tutto minuscolo}',
    'Password: casa mia al mare — tutto minuscolo',
  ]) {
    expect(P.oscura(riga), riga).not.toContain('casa mia al mare');
  }
});
