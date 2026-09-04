// #524 (seconda correzione) — quello che resta all'utente quando l'accoglienza
// si chiude prima della fine.
//
// Il congedo («chiudo qui, la rifacciamo quando vuoi») vive in chat, e la chat
// sparisce appena la home è pronta: col modello giù la home arriva nello stesso
// istante e quella riga non la legge nessuno. Il segno «già accolto», però, è
// definitivo — chi non fa in tempo a leggerla non ha modo di capire perché Filo
// ha smesso di presentarsi, né che si può rifare.
//
// Rossi senza la correzione: la home non diceva niente.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function useFakeKey(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'flash-lite-3',
        [C.ACTIONS.FILO_LESSON]: 'flash-lite-3',
        [C.ACTIONS.FILO_COMPACT]: 'flash-lite-3',
        [C.ACTIONS.FILO_DASHBOARD]: 'flash-lite-3',
      },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
  });
}

// Provider muto su tutta la linea: è il caso peggiore, quello in cui la home
// arriva subito e il congedo dura un lampo.
async function stubMuto(app) {
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    P.streamCompleteWithFallback = async () => { throw new Error('provider giù'); };
    P.completeWithFallback = async () => { throw new Error('provider giù'); };
  });
}

const onbState = (app) => app.evaluate(() => globalThis.SN_FILO_MEMORY.getOnboarding());

async function apriIntervista(app, shell) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await useFakeKey(app);
  await stubMuto(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
  return page;
}

test('chiusa a metà, la home dice come riprenderla — e la riprende davvero', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervista(app, shell);

  await page.locator('#input').fill('basta così');
  await page.locator('#sendBtn').click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 30_000 });

  // La riga è sulla home, non solo nella chat appena svuotata.
  const riga = page.locator('#onbNotice');
  await expect(riga).toBeVisible({ timeout: 15_000 });
  await expect(riga).toContainText('presentazione');
  await page.screenshot({ path: 'tests/.shots/524-riga-ripresa.png' }).catch(() => {});

  // E resta: chi riapre la scheda domani la ritrova finché non risponde.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#onbNotice')).toBeVisible({ timeout: 15_000 });

  // «Riprendiamola» riapre l'intervista lì dov'è l'utente, senza mandarlo a
  // cercare il pulsante in Preferenze.
  await page.locator('#onbNoticeRedo').click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
  await expect(page.locator('.dash-bubble-filo').first()).toContainText('Ciao, sono Filo');
  expect((await onbState(app)).done, 'l’accoglienza è di nuovo aperta').toBe(false);
});

test('chi la toglie non se la ritrova, e chi non l’ha mai chiusa a metà non la vede', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervista(app, shell);

  await page.locator('#input').fill('basta così');
  await page.locator('#sendBtn').click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 30_000 });
  await expect(page.locator('#onbNotice')).toBeVisible({ timeout: 15_000 });

  await page.locator('#onbNoticeDismiss').click();
  await expect(page.locator('#onbNotice')).toBeHidden();
  await expect.poll(() => onbState(app).then((s) => s.notice), { timeout: 10_000 }).toBe('');

  // Riaprendo non torna: l'utente ha già risposto a quella riga.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1_500);
  await expect(page.locator('#onbNotice')).toBeHidden();

  // E un'accoglienza arrivata in fondo non lascia nessuna riga: non c'è niente
  // da spiegare, la home è già il suo risultato.
  await app.evaluate(async () => {
    const O = globalThis.SN_ONBOARDING;
    const M = globalThis.SN_FILO_MEMORY;
    let s = O.appendTurn(O.emptyState(), { role: 'filo', text: O.WELCOME_MESSAGE });
    s = O.appendTurn(s, { role: 'user', text: 'sono Anna' });
    await M.setOnboarding(O.close(O.tick(s, O.ITEM_IDS).state));
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1_500);
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home');
  await expect(page.locator('#onbNotice')).toBeHidden();
});
