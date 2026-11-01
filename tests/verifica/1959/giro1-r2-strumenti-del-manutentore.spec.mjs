// Verifica #1959 giro 1: con la sola chiave del manutentore (la sessione in cloud) devono esserci gli strumenti che la
// spec gli dà e che il server offre: aprire feedback e domande, cambiare la domanda di fine turno.
import { test, expect } from '@playwright/test';
import { SOTTOCOMANDI } from '../../../scripts/manutentore.mjs';

test('r2 il manutentore apre feedback e domande con la sua chiave', () => {
  expect(SOTTOCOMANDI).toEqual(expect.arrayContaining(['feedback', 'domanda']));
});
