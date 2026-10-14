// #1097 giro 3 — una risposta del correttore arrivata in ritardo su un testo che nel frattempo è cambiato non lascia il
// testo senza segni e senza un nuovo controllo.
import { test, expect } from '@playwright/test';
import { correttore } from './correttore-finto.mjs';

const A = 'Marco e Luca è andato al mare ieri';
const B = 'Marco è andato al mare ieri';

test('r7 annulla durante il controllo e poi un punto: il segno torna o parte un nuovo controllo', async () => {
  const c = correttore(); const el = c.campo(); c.entra(el);
  c.scrive(el, A); await c.fireAll();
  c.risponde(0, 'Marco e Luca **è andato** al mare ieri', [{ type: 'grammar', explanation: 'x', correction: 'sono andati' }]); await c.fireAll();
  c.scrive(el, B); await c.fireAll();
  c.scrive(el, A); await c.fireAll();
  c.scrive(el, A + '.'); await c.fireAll();
  c.risponde(1, B, []); await c.fireAll();
  const ricontrollato = c.chiamate.n > 2;
  expect(ricontrollato || c.segni().includes('è andato')).toBe(true);
});

test('r7 una virgola dentro il punto segnato, scritta durante il controllo: il punto si ricontrolla', async () => {
  const c = correttore(); const el = c.campo(); c.entra(el);
  c.scrive(el, A); await c.fireAll();
  c.scrive(el, 'Marco e Luca è, andato al mare ieri'); await c.fireAll();
  c.risponde(0, 'Marco e Luca **è andato** al mare ieri', [{ type: 'grammar' }]); await c.fireAll();
  expect(c.chiamate.n).toBeGreaterThan(1);
});
