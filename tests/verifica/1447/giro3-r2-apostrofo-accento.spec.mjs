// Verifica #1447 giro 3, rilievo 2: chi scrive gli accenti con l'apostrofo si vede correggere «e'» ma non «perche'»,
// «piu'», «cosi'», che restano solo segnati.
import { test, expect } from '../../fixtures/electron.mjs';
import { apriPagina, CAMPO, scrivi } from './aiuto-giro3.mjs';

test('r2 «perche\'», «piu\'» e «cosi\'» si correggono a fine parola come «e\'»', async ({ app, openTab, testServer }) => {
  const page = await apriPagina(app, openTab, testServer, CAMPO);
  expect(await scrivi(page, "Ok e' vero ")).toBe('Ok è vero ');
  expect(await scrivi(page, "Ok perche' no ")).toBe('Ok perché no ');
  expect(await scrivi(page, "Ci vediamo piu' tardi ")).toBe('Ci vediamo più tardi ');
  expect(await scrivi(page, "Va bene cosi' ")).toBe('Va bene così ');
  // «po'» resta com'è: lì l'apostrofo è giusto.
  expect(await scrivi(page, "Aspetta un po' ")).toBe("Aspetta un po' ");
});
