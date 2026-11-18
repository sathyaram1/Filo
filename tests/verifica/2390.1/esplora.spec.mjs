import { test, expect } from '../../fixtures/electron.mjs';
import { modelloFinto, chiedi } from '../../helpers/chatFinta.mjs';

async function homePage(app) {
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 8_000 });
  return page;
}
const nellAngolo = (shell) => shell.locator('.shell-notif[data-luogo="angolo"]:not([data-closing="1"])');

test('timer scaduto su un sito, poi una scheda nuova (la home): niente seconda carta, l\'angolo si svuota', async ({ app, shell, avvisi, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>Un sito</h1>');
  // Via la home di partenza: la home arriva da una scheda nuova.
  const s = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  for (const t of s.tabs) if (String(t.url || '').startsWith('filo://newtab')) await shell.evaluate((id) => window.filoShell.tabs.close(id), t.id);
  const tipo = await shell.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await shell.evaluate(([t]) => window.filoShell.message({ type: t, label: 'Nuova', seconds: 1 }), [tipo]);
  await shell.waitForTimeout(1300);
  await app.evaluate(async () => { await globalThis.__filoAlarmWatcher._tick(); });
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: 'Nuova' })).toBeVisible({ timeout: 8_000 });
  await openTab('filo://newtab/');
  const home = await homePage(app);
  await expect(home.locator('#accade > .dash-carta[data-chiave^="timer:"]')).toHaveCount(1, { timeout: 5_000 });
  await expect(nellAngolo(shell)).toHaveCount(0, { timeout: 3_000 });
  await home.waitForTimeout(6000);
  await expect(home.locator('#accade > .dash-carta[data-tipo="cornice"]')).toHaveCount(0);
});

test('chiesto a Filo «chiudi gli avvisi»: anche quelli volati nella colonna si chiudono', async ({ app, shell }) => {
  test.setTimeout(60_000);
  const home = await homePage(app);
  await shell.evaluate(() => window.filoNotify('Primo avviso volato', { durationSec: 1 }));
  await shell.evaluate(() => window.filoNotify('Secondo avviso volato', { durationSec: 1 }));
  const carte = home.locator('#accade > .dash-carta[data-tipo="cornice"]');
  await expect(carte).toHaveCount(2, { timeout: 10_000 });
  await app.evaluate(async () => { await chrome.storage.local.set({ filo_onboarding: { done: true } }); });
  await modelloFinto(app, [
    { toolCalls: [{ id: 'c1', name: 'CARTA_HOME', arguments: '{"operazione":"togli","carta":"gli avvisi"}' }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(home, 'chiudi gli avvisi');
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 10_000 });
  await expect(carte).toHaveCount(0, { timeout: 5_000 });
});
