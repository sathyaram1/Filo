// Esplorazione: non asserisce niente, stampa e basta. Da cancellare.
import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, fakeProvider, restore, chiedi } from './aiuto.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';

test('il riordino col giudizio che non arriva', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(160_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await openTab(testServer.html('<html><body><h1>una</h1></body></html>'));
  await openTab(testServer.html('<html><body><h1>due</h1></body></html>'));

  console.log('DECIDE presente:', await app.evaluate(() => typeof globalThis.SN_TAB_TRIAGE_DECIDE));
  await app.evaluate(() => {
    globalThis.SN_TAB_TRIAGE_DECIDE = async () => { throw new Error('crediti finiti'); };
  });

  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] }));

  await fakeProvider(app, [
    { toolCalls: [{ id: 'e2', name: 'PULISCI_TAB', arguments: '{}' }] },
    { text: 'Valuto le schede aperte.' },
  ], '__v567e2');

  await chiedi(page, 'riordina le schede e archivia quelle che non servono');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Valuto le schede aperte.' })).toBeVisible({ timeout: 15_000 });

  const btn = page.locator('.dash-action-btn', { hasText: 'Riordina e archivia' });
  await btn.click();
  await clickConfirm(page, 'ok', { timeout: 10_000 });
  for (let i = 0; i < 12; i += 1) {
    await page.waitForTimeout(5000);
    console.log(`t=${(i + 1) * 5}s BOTTONE:`, JSON.stringify(((await btn.textContent()) || '').trim()),
      'TITOLO:', JSON.stringify(((await page.locator('.dash-activity-label').first().textContent()) || '').trim()));
  }
  await restore(app, '__v567e2');
});
