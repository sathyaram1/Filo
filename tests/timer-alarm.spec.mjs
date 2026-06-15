// Test per la funzione di allarme del timer (#suoneria):
// - Un timer scaduto passa allo stato ringing (data-ringing="1" su #live).
// - La card del timer rimane visibile con testo "scaduto" e pulsante "Ferma".
// - Premendo "Ferma" lo stato ringing sparisce e il timer è rimosso.
// - La preferenza timerRingtone persiste in storage.

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

test('timer scaduto: card ringing visibile, "Ferma" la rimuove', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  // Aspetta che la pagina sia pronta (SN_MSG disponibile).
  await page.waitForFunction(() => !!window.SN_MSG, { timeout: 8_000 });

  // 1) Aggiungi un timer da 1 secondo via IPC.
  const addRes = await page.evaluate(() => new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: window.SN_MSG.MSG.FILO_ADD_TIMER, label: 'Test Suoneria', seconds: 1 },
      resolve,
    );
  }));
  expect(addRes?.ok).toBe(true);
  const timerId = addRes?.timer?.id;
  expect(timerId).toBeTruthy();

  // 2) Aspetta che il timer scada (1s) + lascia del margine perché il ticker della
  //    dashboard chiami gcTimers() e aggiorni il DOM.
  //    Il refreshLive ogni 1s aggiornerà `#live` non appena il timer è scaduto.
  await page.waitForFunction(
    () => document.getElementById('live')?.dataset?.ringing === '1',
    { timeout: 6_000, polling: 250 },
  );

  // 3) La card del timer ringing deve essere visibile con testo "scaduto".
  const ringCard = page.locator('.dash-live-card[data-ringing="1"]');
  await expect(ringCard).toBeVisible({ timeout: 3_000 });
  await expect(ringCard).toContainText('scaduto');
  await expect(ringCard).toContainText('Test Suoneria');

  // 4) Il pulsante "Ferma" deve essere presente.
  const stopBtn = ringCard.locator('.dash-live-stop');
  await expect(stopBtn).toBeVisible();

  // 5) Clicca "Ferma": il timer deve sparire e lo stato ringing deve azzerarsi.
  await stopBtn.click();

  // Aspetta che lo stato ringing sparisca (il tick refreshLive aggiornerà il DOM).
  await page.waitForFunction(
    () => document.getElementById('live')?.dataset?.ringing === '0',
    { timeout: 5_000, polling: 250 },
  );

  // La card ringing non deve più essere presente.
  await expect(page.locator('.dash-live-card[data-ringing="1"]')).toHaveCount(0, { timeout: 3_000 });

  // 6) Verifica anche via IPC che il timer non sia più in lista.
  const timersRes = await page.evaluate(() => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.FILO_GET_TIMERS }, resolve);
  }));
  expect(timersRes?.ok).toBe(true);
  const ids = (timersRes?.timers || []).map((t) => t.id);
  expect(ids).not.toContain(timerId);
});

test('preferenza timerRingtone persiste in storage', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  // Aspetta che SN_STORAGE e SN_CONST siano disponibili.
  await page.waitForFunction(() => !!window.SN_STORAGE && !!window.SN_CONST, { timeout: 8_000 });

  // Salva la preferenza timerRingtone = 'gentle' via UPDATE_SETTINGS.
  await page.evaluate(() => new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { timerRingtone: 'gentle' } },
      resolve,
    );
  }));

  // Rilancia il load delle settings e verifica che il valore persista.
  const saved = await page.evaluate(async () => {
    const settings = await window.SN_STORAGE.getSettings();
    return settings.timerRingtone;
  });
  expect(saved).toBe('gentle');

  // Pulisci: ripristina il default.
  await page.evaluate(() => new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { timerRingtone: 'default' } },
      resolve,
    );
  }));
});
