// Verifica #810, giro 3, rilievo 4: il codice monouso detto in forme comuni che il controllo non
// riconosce esce dalla pagina che lo mostra.

import { test, expect } from '../../fixtures/electron.mjs';
import { CODICE, preparaModelli, modelloFinto, apriAiuto, scriviAllAiuto, esitoUscita, NAVIGA_COL_CODICE } from './aiuti.mjs';

for (const frase of [
  `Il tuo codice di sicurezza monouso è ${CODICE}.`,
  `Codice di accesso monouso: ${CODICE}`,
  `Your single-use code is: ${CODICE}`,
  `Codice di autenticazione a due fattori: ${CODICE}`,
  `Two-factor authentication code: ${CODICE}`,
]) {
  test(`l’assistente di pagina non porta fuori «${frase}»`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Accesso</title></head>
      <body style="padding:40px;font:16px sans-serif"><h1>Accesso</h1><p>${frase}</p><p>Non darlo a nessuno.</p></body></html>`);
    await preparaModelli(app);
    await modelloFinto(app, { aiuto: [['', NAVIGA_COL_CODICE]] });
    await apriAiuto(shell, page);
    await scriviAllAiuto(page, 'aiutami a finire l’accesso');
    expect(await esitoUscita(app, page)).toBe('fermato');
  });
}
