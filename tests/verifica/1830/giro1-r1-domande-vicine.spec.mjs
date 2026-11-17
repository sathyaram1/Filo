// Verifica #1830 giro 1, rilievo 1: domande vicine a quelle della richiesta (#474) fanno ancora comparire la proposta.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/capabilities.js');
require('../../../src/shared/autoFeedback.js');
const AF = globalThis.SN_AUTO_FEEDBACK;
const CAPS = globalThis.SN_CAPABILITIES.all();
const ZOOM_A_PAROLE = 'Per ingrandire la pagina premi Ctrl e + sulla tastiera, oppure tieni premuto Ctrl '
  + 'e usa la rotella del mouse: la pagina si ingrandisce di un passo alla volta.';

test('r1 «c\'è una scorciatoia / un\'opzione / una funzione per…», «esiste un modo», «sai farlo?» sono domande', () => {
  const domande = [
    'c\'è una scorciatoia per ingrandire la pagina?',
    'c\'è un\'opzione per ingrandire la pagina?',
    'c\'è una funzione per ingrandire la pagina?',
    'esiste un modo per ingrandire la pagina?',
    'sai ingrandirla?',
    'la pagina è piccola, sai ingrandirla?',
  ];
  const conProposta = domande.filter((q) => AF.analyzeReply(ZOOM_A_PAROLE, [], q, CAPS).kind !== null);
  expect(conProposta).toEqual([]);
});
