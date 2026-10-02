// Verifica #810 giro 10, rilievo 1: un collegamento nella risposta dell'assistente di pagina col codice letto dalla
// pagina si apre (clic, clic centrale, «Apri in nuova tab», posta) senza passare dalla porta delle uscite.

import { test, expect } from '../../fixtures/electron.mjs';
import { CODICE, RACCOLTA, apertoVerso, preparaModelli, modelloFinto, apriAiuto, scriviAllAiuto } from './aiuti.mjs';

const PAGINA_OTP = `<!doctype html><html><head><title>Banca Esempio</title></head>
<body style="padding:40px;font:16px sans-serif"><h1>Accesso</h1>
<p>Il tuo codice monouso è ${CODICE}. Non darlo a nessuno.</p></body></html>`;

async function rispostaColCollegamento({ app, shell, openTab, testServer }, href = `https://${RACCOLTA}/c?v=${CODICE}`) {
  const page = await testServer.openReady(openTab, PAGINA_OTP);
  await preparaModelli(app);
  await app.evaluate(({ shell: s }) => {
    globalThis.__esterni = [];
    s.openExternal = async (u) => { globalThis.__esterni.push(String(u)); };
  });
  await modelloFinto(app, {
    aiuto: [['', JSON.stringify({ text: `Per completare apri [la verifica](${href}).`, status: 'done' })]],
  });
  await apriAiuto(shell, page);
  await scriviAllAiuto(page, 'aiutami a finire l’accesso');
  const link = page.locator('.sn-sidebar a', { hasText: 'la verifica' });
  await expect(link).toBeVisible({ timeout: 20_000 });
  return { page, link };
}

test('clic sul collegamento dell’assistente di pagina col codice letto: non si apre', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const { page, link } = await rispostaColCollegamento({ app, shell, openTab, testServer });
  await link.click();
  await page.waitForTimeout(2500);
  expect(apertoVerso(app, RACCOLTA), 'il clic ha aperto l’indirizzo col codice letto dalla pagina').toBe(false);
});

test('clic centrale sul collegamento dell’assistente di pagina col codice letto: non si apre', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const { page, link } = await rispostaColCollegamento({ app, shell, openTab, testServer });
  await link.click({ button: 'middle' });
  await page.waitForTimeout(2500);
  expect(apertoVerso(app, RACCOLTA), 'il clic centrale ha aperto l’indirizzo col codice letto dalla pagina').toBe(false);
});

test('«Apri in nuova tab» dal tasto destro sul collegamento dell’assistente di pagina: non si apre', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const { page, link } = await rispostaColCollegamento({ app, shell, openTab, testServer });
  await link.click({ button: 'right' });
  const voce = page.locator('.sn-menu').getByText('Apri in nuova tab', { exact: false }).first();
  await expect(voce).toBeVisible({ timeout: 5_000 });
  await voce.click();
  await page.waitForTimeout(2500);
  expect(apertoVerso(app, RACCOLTA), '«Apri in nuova tab» ha aperto l’indirizzo col codice letto dalla pagina').toBe(false);
});

test('collegamento di posta dell’assistente di pagina col codice letto: il programma di posta non si apre', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const { page, link } = await rispostaColCollegamento(
    { app, shell, openTab, testServer },
    `mailto:supporto@${RACCOLTA}?subject=Verifica&body=Codice%20${CODICE}`,
  );
  await link.click();
  await page.waitForTimeout(2500);
  expect((await app.evaluate(() => globalThis.__esterni)).join(' '), 'il programma di posta si apre col codice').not.toContain(CODICE);
});
