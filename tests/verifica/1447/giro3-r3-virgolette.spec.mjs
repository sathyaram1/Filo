// Verifica #1447 giro 3, rilievo 3: una «e» fra virgolette semplici perde la virgoletta di chiusura e diventa «è».
import { test, expect } from '../../fixtures/electron.mjs';
import { apriPagina, CAMPO, scrivi } from './aiuto-giro3.mjs';

test('r3 la congiunzione \'e\' fra virgolette semplici resta com\'è scritta', async ({ app, openTab, testServer }) => {
  const page = await apriPagina(app, openTab, testServer, CAMPO);
  expect(await scrivi(page, "La congiunzione 'e' si scrive senza accento ")).toBe("La congiunzione 'e' si scrive senza accento ");
});
