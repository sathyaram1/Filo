// #2229 giro 1: chi conosce il feedback solo per numero lo scrive col cancelletto anche nei collegamenti (il lavoro che
// il «da fare» aspetta). Il numero va tradotto nell'id come nelle azioni, o rifiutato col numero: mai salvato muto.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/feedbackAttese.js');
require('../../../src/shared/domande.js');
const D = globalThis.SN_DOMANDE;

test('r2 un collegamento «#1736» diventa l’id del feedback, o si rifiuta col numero', () => {
  const v = D.validaDomanda({
    tipo: 'da_fare', titolo: 'Rinnova il token di GitHub', priorita: 'importante',
    problema: 'Dalle impostazioni di GitHub rigenera il token e incollalo in Automazioni.',
    collegamenti: [{ tipo: 'feedback', id: '#1736' }],
    opzioni: [{ testo: 'Fatto', azione: { tipo: 'nessuna' } }],
  }, { conOrigine: false });
  if (!v.ok) {
    expect(v.dettaglio).toContain('#1736');
    return;
  }
  // La strada del server: i numeri da chiedere, poi la traduzione con gli id letti.
  expect(D.numeriDaTradurre(v.domanda)).toContain('1736');
  const t = D.traduciNumeri(v.domanda, { 1736: 'fb1736' });
  expect(t.ok).toBe(true);
  expect(t.domanda.collegamenti).toEqual([{ tipo: 'feedback', id: 'fb1736' }]);
  // Un numero che non c'è si rifiuta col numero, come nelle azioni.
  const n = D.traduciNumeri(v.domanda, {});
  expect(n.ok).toBe(false);
  expect(n.dettaglio).toContain('#1736');
});
