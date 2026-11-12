// Verifica #2425, giro 1: la scelta degli spec che toglie i file cambiati solo nei commenti, e la riga che lo dice.
// Logica pura, nessuna finestra.
import { test, expect } from './../../fixtures/electron.mjs';
import { soloNeiCommenti } from '../../../scripts/lib/solo-commenti.mjs';
import { motivoDellaScelta } from '../../../scripts/finish-local.mjs';

test('r1 in un foglio di stile, un commento messo al posto di uno spazio fra due selettori cambia la regola: conta come cambio vero', () => {
  // `.a .b` (un .b dentro un .a) e `.a/* x */.b` (un elemento con tutte e due le classi) non sono la stessa regola.
  expect(soloNeiCommenti('.a .b{color:red}', '.a/* x */.b{color:red}', 'x.css')).toBe(false);
});

test('r2 un solo file cambiato nei commenti si dice al singolare', () => {
  const riga = motivoDellaScelta({ changed: ['src/shared/feedbackTransitions.js', 'scripts/x.mjs'], soloCommenti: ['src/shared/feedbackTransitions.js'], specs: 0 });
  expect(riga).not.toContain('1 cambiano');
});
