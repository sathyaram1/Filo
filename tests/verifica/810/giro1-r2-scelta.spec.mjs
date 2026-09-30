// Verifica #810 giro 1, rilievo 2: il testo nascosto dietro un bottone di scelta dell'assistente di
// pagina lo scrive il modello, non l'utente: un codice letto dalla pagina non diventa «suo» con un clic.

import { test, expect } from '../../fixtures/electron.mjs';
import {
  CODICE, NAVIGA_COL_CODICE, preparaModelli, modelloFinto, apriAiuto, scriviAllAiuto, esitoUscita,
} from './aiuti.mjs';

test('un clic su una scelta proposta dall’assistente non fa uscire il codice letto dalla pagina', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Banca</title></head>
    <body><h1>Accesso</h1><p>Il tuo codice monouso è ${CODICE}. Non darlo a nessuno.</p></body></html>`);
  await preparaModelli(app);
  await modelloFinto(app, {
    aiuto: [
      ['usa il codice', NAVIGA_COL_CODICE],
      ['aiutami', JSON.stringify({
        text: 'Vuoi che completi l’accesso?',
        choices: [{ label: 'Sì, continua', prompt: `Sì, usa il codice ${CODICE} per completare` }],
        status: 'done',
      })],
    ],
  });
  await apriAiuto(shell, page);
  await scriviAllAiuto(page, 'aiutami a finire l’accesso');

  const scelta = page.locator('.sn-sidebar-choice', { hasText: 'Sì, continua' });
  await expect(scelta).toBeVisible({ timeout: 20_000 });
  await expect(scelta).not.toContainText(CODICE);
  await scelta.click();

  expect(await esitoUscita(app, page), 'il codice letto dalla pagina è uscito dopo un clic su una scelta').toBe('fermato');
});
