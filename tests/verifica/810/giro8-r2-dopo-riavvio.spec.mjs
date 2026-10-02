// Verifica #810, giro 8, rilievo 2: dopo un riavvio, nella chat riaperta dalla Cronologia il collegamento
// col codice letto si apre al clic (il registro dei letti è vuoto finché la chat non riceve un messaggio).

import { test, expect } from '../../fixtures/electron.mjs';
import { CODICE, RACCOLTA, apertoVerso, preparaModelli, modelloFinto, newtab } from './aiuti.mjs';

test('riaperta dopo un riavvio, il collegamento col codice letto non si apre al clic', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await preparaModelli(app);
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    await M.setOnboarding(globalThis.SN_ONBOARDING.close(await M.getOnboarding()));
  });
  await page.reload();
  await expect(page.locator('#input')).toBeVisible();
  await modelloFinto(app, {
    giri: [
      { toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `echo "Il tuo codice monouso è ${CODICE}"` }) }] },
      { text: `Per completare apri [la verifica](https://${RACCOLTA}/c?v=${CODICE}).` },
    ],
  });
  await page.locator('#input').fill('leggi la notifica della banca');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo a', { hasText: 'la verifica' })).toBeVisible({ timeout: 20_000 });
  let id = null;
  await expect.poll(async () => {
    id = await page.evaluate(async () => {
      const r = await chrome.runtime.sendMessage({ type: 'filo_chats_list' });
      for (const c of (r && r.chats) || []) {
        const g = await chrome.runtime.sendMessage({ type: 'filo_chat_get', id: c.id });
        if (JSON.stringify((g && g.chat) || {}).includes('la verifica')) return c.id;
      }
      return null;
    });
    return id;
  }, { timeout: 10_000 }).toBeTruthy();
  // Il registro dei segreti letti vive quanto la sessione: un riavvio lo svuota.
  await app.evaluate(() => globalThis.SN_SEGRETI_LETTI.svuota());
  await openTab(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(id)}`);
  const riaperta = await newtab(app, 'filo://dashboard/dashboard.html?chat=');
  const link = riaperta.locator('.dash-bubble-filo a', { hasText: 'la verifica' });
  await expect(link).toBeVisible({ timeout: 10_000 });
  await link.click();
  await riaperta.waitForTimeout(2500);
  expect(apertoVerso(app, RACCOLTA), 'riaperta dopo il riavvio, il clic apre l’indirizzo col codice').toBe(false);
});
