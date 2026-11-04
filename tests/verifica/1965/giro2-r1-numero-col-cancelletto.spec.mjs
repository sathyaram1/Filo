// #1965 giro 2: chi applica «aspetta» copia il numero dalle parole dell'owner («#1959»): o vale, o il rifiuto dice come scriverlo.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/feedbackAttese.js');
require('../../../src/shared/domande.js');
const D = globalThis.SN_DOMANDE;

test('r1 «aspetta» col numero scritto come lo scrive l’owner: accettato, o rifiutato dicendo la forma giusta', () => {
  for (const aspetta of ['#1959', ' 1959']) {
    const v = D.validaAzione({ tipo: 'attendi', feedbackId: 'f1', aspetta });
    if (v.ok) continue;
    expect(v.dettaglio, aspetta).toMatch(/senza|«1959»|cancelletto|cifre|forma/i);
  }
});
