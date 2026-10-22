// Verifica #1447 giro 3, rilievo 1: un nome o un marchio dopo un apostrofo d'elisione («l'italia», «dell'europa»,
// «l'iphone») non prende la maiuscola, mentre da solo sì.
import { test, expect } from '../../fixtures/electron.mjs';
import { apriPagina, CAMPO, scrivi } from './aiuto-giro3.mjs';

test('r1 «l\'italia», «dell\'europa» e «l\'iphone» prendono la maiuscola come «italia» da sola', async ({ app, openTab, testServer }) => {
  const page = await apriPagina(app, openTab, testServer, CAMPO);
  expect(await scrivi(page, 'Vado in italia ')).toBe('Vado in Italia ');
  expect(await scrivi(page, "Mi piace l'italia ")).toBe("Mi piace l'Italia ");
  expect(await scrivi(page, "Il sud dell'europa ")).toBe("Il sud dell'Europa ");
  expect(await scrivi(page, "Ho comprato l'iphone ")).toBe("Ho comprato l'iPhone ");
});
