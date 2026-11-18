// app.evaluate entra nel main dall'ispettore, nel contesto di quello che il main sta eseguendo in quel momento:
// mentre gira un lavoro della finestra incognito, una lettura della prova vedeva i dati dell'incognito (#2577).
// La fixture fa girare ogni app.evaluate nel contesto normale; senza, la prima prova è rossa.
import { test, expect } from './fixtures/electron.mjs';

// Un lavoro sincrono lungo nel contesto incognito: l'ispettore consegna la chiamata della prova a metà.
const occupaInIncognito = (app, ms) => app.evaluate((_e, durata) => {
  setTimeout(() => globalThis.__filoStorage.runIncognito(() => {
    const fine = Date.now() + durata;
    while (Date.now() < fine) { /* occupato */ }
  }), 50);
  return true;
}, ms);

test('una lettura fatta mentre il main lavora per la finestra incognito legge il lato normale', async ({ app }) => {
  await occupaInIncognito(app, 1500);
  await new Promise((r) => setTimeout(r, 300));
  expect(await app.evaluate(() => globalThis.__filoStorage.inIncognito())).toBe(false);
});
