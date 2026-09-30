// Esplorazione: le righe di blocco nel tema scuro (chat e assistente di pagina).

import { test, expect } from '../../fixtures/electron.mjs';
import { CODICE, RACCOLTA, NAVIGA_COL_CODICE, preparaModelli, modelloFinto, apriAiuto, scriviAllAiuto, esitoUscita, newtab } from './aiuti.mjs';

async function scuro(app) {
  await app.evaluate(async () => {
    await globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }, { url: 'filo://preferences/preferences.html' });
  });
}

test('chat, tema scuro', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await preparaModelli(app);
  await scuro(app);
  await modelloFinto(app, {
    giri: [
      { toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `echo "Il tuo codice monouso è ${CODICE}"` }) }] },
      { toolCalls: [{ id: 'n1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: `verifica ${CODICE}` }) }] },
      { text: 'Non l’ho cercato.' },
    ],
  });
  await page.locator('#input').fill('leggi la notifica della banca');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Non l’ho cercato' })).toBeVisible({ timeout: 20_000 });
  const activity = page.locator('.dash-activity').last();
  await activity.locator('.dash-activity-head').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/810-chat-scuro.png' });
});

test('assistente di pagina, tema scuro', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Banca</title></head>
    <body><h1>Accesso</h1><p>Il tuo codice monouso è ${CODICE}.</p></body></html>`);
  await preparaModelli(app);
  await scuro(app);
  await modelloFinto(app, { aiuto: [['finire', NAVIGA_COL_CODICE]] });
  await apriAiuto(shell, page);
  await scriviAllAiuto(page, 'aiutami a finire l’accesso');
  expect(await esitoUscita(app, page)).toBe('fermato');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/810-aiuto-scuro.png' });
  console.log('RACCOLTA', RACCOLTA);
});
