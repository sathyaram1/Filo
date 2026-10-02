// Verifica #810, giro 8: esplorazione delle porte rimaste sul clic delle proposte di un modello.

import { test, expect } from '../../fixtures/electron.mjs';
import { CODICE, RACCOLTA, apertoVerso, preparaModelli, modelloFinto, newtab } from './aiuti.mjs';

async function senzaAccoglienza(app, page) {
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    await M.setOnboarding(globalThis.SN_ONBOARDING.close(await M.getOnboarding()));
  });
  await page.reload();
  await expect(page.locator('#input')).toBeVisible();
}

async function rispostaConCollegamento(app, page, risposta) {
  await preparaModelli(app);
  await senzaAccoglienza(app, page);
  await modelloFinto(app, {
    giri: [
      { toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `echo "Il tuo codice monouso è ${CODICE}"` }) }] },
      { text: risposta },
    ],
  });
  await page.locator('#input').fill('leggi la notifica della banca');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo a').first()).toBeVisible({ timeout: 20_000 });
}

test('tasto destro sul collegamento della risposta, «Apri in nuova tab»', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await rispostaConCollegamento(app, page, `Per completare apri [la verifica](https://${RACCOLTA}/c?v=${CODICE}).`);
  const link = page.locator('.dash-bubble-filo a', { hasText: 'la verifica' });
  await link.click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 5_000 });
  await page.screenshot({ path: 'tests/.shots/giro8-menu-link.png' }).catch(() => {});
  await menu.getByText('Apri in nuova tab', { exact: false }).first().click();
  await page.waitForTimeout(2500);
  expect(apertoVerso(app, RACCOLTA), 'il menu del tasto destro ha aperto l’indirizzo col codice').toBe(false);
});

test('clic col tasto centrale sul collegamento della risposta', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await rispostaConCollegamento(app, page, `Per completare apri [la verifica](https://${RACCOLTA}/c?v=${CODICE}).`);
  await page.locator('.dash-bubble-filo a', { hasText: 'la verifica' }).click({ button: 'middle' });
  await page.waitForTimeout(2500);
  expect(apertoVerso(app, RACCOLTA)).toBe(false);
});

test('collegamento di posta nella risposta', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await app.evaluate(({ shell: s }) => {
    globalThis.__esterni = [];
    s.openExternal = async (u) => { globalThis.__esterni.push(String(u)); };
  });
  await rispostaConCollegamento(app, page, `Se non funziona [scrivi al supporto](mailto:supporto@${RACCOLTA}?subject=Verifica&body=Codice%20${CODICE}).`);
  await page.locator('.dash-bubble-filo a', { hasText: 'scrivi al supporto' }).click();
  await page.waitForTimeout(2500);
  const esterni = await app.evaluate(() => globalThis.__esterni);
  expect(esterni.join(' '), 'il client di posta si apre col codice dentro').not.toContain(CODICE);
});

test('dopo un riavvio, il collegamento di una chat riaperta', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await rispostaConCollegamento(app, page, `Per completare apri [la verifica](https://${RACCOLTA}/c?v=${CODICE}).`);
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
  await app.evaluate(() => globalThis.SN_SEGRETI_LETTI.svuota());
  await openTab(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(id)}`);
  const riaperta = await newtab(app, 'filo://dashboard/dashboard.html?chat=');
  const link = riaperta.locator('.dash-bubble-filo a', { hasText: 'la verifica' });
  await expect(link).toBeVisible({ timeout: 10_000 });
  await link.click();
  await riaperta.waitForTimeout(2500);
  expect(apertoVerso(app, RACCOLTA), 'riaperta dopo il riavvio, il clic apre l’indirizzo col codice').toBe(false);
});
