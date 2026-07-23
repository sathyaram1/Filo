// Feedback #260: il campo `paused` dei timer era codice morto — nessun comando
// poteva portarlo a true, quindi "(in pausa)" non compariva mai e l'utente non
// poteva mettere in pausa un timer.
//
// Questo test ASSERISCE il flusso reale end-to-end nella nuova scheda:
//   1. creo un timer;
//   2. sulla sua card compare il pulsante ⏸ (prima non c'era nulla);
//   3. cliccando ⏸ la card mostra "(in pausa)" e il pulsante diventa ▶;
//   4. cliccando ▶ il timer riparte: "(in pausa)" sparisce e torna ⏸.
//
// Senza il fix il pulsante non esisterebbe (passo 2 rosso) e comunque nessun
// click potrebbe far apparire "(in pausa)" (passo 3 rosso).

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata entro 10s').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  return win;
}

test('timer: pausa e ripresa dalla card nella nuova scheda', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#homeMessage')).toBeVisible({ timeout: 8_000 });

  // Creo un timer lungo (10 min) usando lo stesso canale della UI. Il main
  // risponde e fa broadcast → la colonna live si aggiorna da sola.
  const added = await page.evaluate(async () => {
    const MSG = window.SN_MSG.MSG;
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: MSG.FILO_ADD_TIMER, label: 'TestPausa', seconds: 600 },
        (r) => resolve(r),
      );
    });
  });
  expect(added?.ok, 'timer creato').toBeTruthy();

  const card = page.locator('.dash-live-card', { hasText: 'TestPausa' });
  await expect(card).toBeVisible({ timeout: 8_000 });

  // Stato iniziale: NON in pausa, e il pulsante di pausa esiste (⏸).
  await expect(card).not.toContainText('(in pausa)');
  const pauseBtn = card.locator('.dash-live-pause');
  await expect(pauseBtn).toHaveText('⏸', { timeout: 4_000 });

  // Metto in pausa.
  await pauseBtn.click();
  await expect(page.locator('.dash-live-card', { hasText: 'TestPausa' }))
    .toContainText('(in pausa)', { timeout: 4_000 });
  await expect(page.locator('.dash-live-card', { hasText: 'TestPausa' }).locator('.dash-live-pause'))
    .toHaveText('▶', { timeout: 4_000 });

  // Riprendo.
  await page.locator('.dash-live-card', { hasText: 'TestPausa' }).locator('.dash-live-pause').click();
  await expect(page.locator('.dash-live-card', { hasText: 'TestPausa' }))
    .not.toContainText('(in pausa)', { timeout: 4_000 });
  await expect(page.locator('.dash-live-card', { hasText: 'TestPausa' }).locator('.dash-live-pause'))
    .toHaveText('⏸', { timeout: 4_000 });
});
