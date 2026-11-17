// Verifica #1830 giro 1, rilievo 2: «è possibile» con l'accento ora zittisce anche una richiesta cortese o una lamentela.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/capabilities.js');
require('../../../src/shared/autoFeedback.js');
const AF = globalThis.SN_AUTO_FEEDBACK;
const CAPS = globalThis.SN_CAPABILITIES.all();
const ZOOM_A_PAROLE = 'Per ingrandire la pagina premi Ctrl e + sulla tastiera, oppure tieni premuto Ctrl '
  + 'e usa la rotella del mouse: la pagina si ingrandisce di un passo alla volta.';

test('r2 chi chiede di farlo «se è possibile», o si lamenta con «è possibile che…», riceve ancora la proposta', () => {
  const nonDomande = [
    'ingrandisci la pagina, se è possibile',
    'ingrandisci la pagina se è possibile grazie',
    'è possibile che lo zoom non funzioni mai?',
  ];
  const zittite = nonDomande.filter((q) => AF.analyzeReply(ZOOM_A_PAROLE, [], q, CAPS).kind === null);
  expect(zittite).toEqual([]);
});
