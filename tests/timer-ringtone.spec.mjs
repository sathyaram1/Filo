// Feature: suoneria del timer.
//
// Verifica:
// (a) Alla scadenza di un timer, il contenitore live mostra data-ringing="1"
//     (stato "squilla" osservabile senza audio, perché WebAudio non suona
//     in ambiente headless — ma la presenza dello stato è testabile).
// (b) Il timer rimane visibile dopo la scadenza (non scompare).
// (c) Il pulsante "Ferma" rimuove lo stato ringing.
// (d) La preferenza timerRingtone si salva nello storage e persiste al reload.

import { test, expect } from './fixtures/electron.mjs';

// Trova e restituisce la Page della newtab (dashboard).
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

test('timer alla scadenza: stato ringing visibile e stop lo rimuove', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  // Crea un timer che scade tra 2 secondi tramite il messaggio IPC diretto.
  const msgType = await page.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await page.evaluate(async (type) => {
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, label: 'Test timer', seconds: 2 }, resolve);
    });
  }, msgType);

  // Aspetta che il timer appaia nella colonna live.
  await expect(page.locator('#live .dash-live-card')).toHaveCount(1, { timeout: 4_000 });

  // Aspetta che il timer scada e passi in stato ringing (timeout 6s).
  // Il contenitore live riceve data-ringing="1" quando almeno un timer squilla.
  await expect
    .poll(
      () => page.evaluate(() => document.getElementById('live').dataset.ringing),
      { timeout: 6_000, intervals: [200] },
    )
    .toBe('1');

  // (b) Il timer è ancora visibile (card con data-ringing="1" presente).
  await expect(page.locator('#live .dash-live-card[data-ringing="1"]')).toBeVisible();

  // (c) Il pulsante "Ferma" è visibile e funzionante.
  const stopBtn = page.locator('#live .dash-live-stop');
  await expect(stopBtn).toBeVisible();
  await stopBtn.click();

  // Dopo "Ferma" il timer è rimosso e lo stato ringing torna a "0".
  await expect
    .poll(
      () => page.evaluate(() => document.getElementById('live').dataset.ringing),
      { timeout: 4_000, intervals: [200] },
    )
    .toBe('0');

  // La card del timer non è più presente.
  await expect(page.locator('#live .dash-live-card[data-ringing="1"]')).toHaveCount(0);
});

test('preferenza timerRingtone: si salva e persiste al reload', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#timerRingtone', { timeout: 8_000 });

  // Il controllo esiste.
  await expect(page.locator('#timerRingtone')).toHaveCount(1);
  await expect(page.locator('#timerRingtonePreview')).toHaveCount(1);

  // Cambia la suoneria a "Carillon".
  await page.locator('#timerRingtone').selectOption('chime');
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  // Persiste nello storage.
  await expect
    .poll(
      () => page.evaluate(async () => (await window.SN_STORAGE.getSettings()).timerRingtone),
      { timeout: 4_000 },
    )
    .toBe('chime');

  // Sopravvive a un reload.
  await page.reload();
  await page.waitForSelector('#timerRingtone', { timeout: 8_000 });
  await expect(page.locator('#timerRingtone')).toHaveValue('chime');
});
