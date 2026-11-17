// Verifica #1830 giro 3, rilievo 1: forme comuni di domanda su cui la proposta di segnalazione compare ancora.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/autoFeedback.js');
const AF = globalThis.SN_AUTO_FEEDBACK;

test('r1 le domande comuni con «come», «posso», «si riesce», «sai» e un pronome non fanno partire la proposta', () => {
  const domande = [
    'come ingrandisco la pagina?',
    'posso ingrandire la pagina?',
    'si riesce a ingrandire la pagina?',
    'sai ingrandirla?',
    'sai farlo?',
    'sai dirmi come ingrandire la pagina?',
    'sapresti ingrandire la pagina?',
    'è  possibile ingrandire la pagina?',
  ];
  const mancate = domande.filter((q) => !AF._isHowtoQuestion(q));
  expect(mancate).toEqual([]);
});
