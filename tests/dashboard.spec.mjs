// Dashboard / newtab. Verifica layout + IPC con il main process.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  // Poll: la newtab è aperta dal main subito dopo did-finish-load della shell,
  // ma il "window" event in Playwright può arrivare con qualche ms di ritardo.
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

test('la dashboard renderizza le tre zone + barra input', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  await expect(page.locator('#center')).toBeVisible();
  await expect(page.locator('#left')).toBeAttached();
  await expect(page.locator('#right')).toBeAttached();
  await expect(page.locator('#input')).toBeVisible();
  await expect(page.locator('#sendBtn')).toBeVisible();
  await expect(page.locator('#settingsBtn')).toBeVisible();
  await expect(page.locator('#homeBtn')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home');
  await expect(page.locator('#threadView')).toBeHidden();
});

test('senza API key la dashboard mostra il messaggio di fallback', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#homeMessage')).not.toHaveClass(/dash-home-msg-loading/, { timeout: 8_000 });
  const txt = await page.locator('#homeMessage').textContent();
  expect(txt && txt.length).toBeGreaterThan(0);
});

test('FILO_GET_STATE risponde con tab e tempo via runtime.sendMessage', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  const result = await page.evaluate(() => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'filo_get_state' }, (r) => resolve(r));
  }));
  expect(result?.ok).toBe(true);
  expect(typeof result.stateText).toBe('string');
  expect(result.stateText).toContain('FILO STATE');
  expect(result.state).toBeTruthy();
  expect(Array.isArray(result.state.tabs)).toBe(true);
});

test('FILO_ADD_TIMER crea un timer leggibile via FILO_GET_TIMERS', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  const created = await page.evaluate(() => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'filo_add_timer', label: 'Test', seconds: 30 }, (r) => resolve(r));
  }));
  expect(created?.ok).toBe(true);
  expect(created.timer?.label).toBe('Test');

  const list = await page.evaluate(() => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'filo_get_timers' }, (r) => resolve(r));
  }));
  expect(list?.ok).toBe(true);
  expect(list.timers.some((t) => t.label === 'Test')).toBe(true);

  await page.evaluate((id) => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'filo_delete_timer', id }, (r) => resolve(r));
  }), created.timer.id);
});

test('FILO_ADD_NOTE salva una nota e la rilegge', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  const added = await page.evaluate(() => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'filo_add_note', text: 'comprare il pane', context: 'spesa' }, (r) => resolve(r));
  }));
  expect(added?.ok).toBe(true);
  expect(added.note?.text).toBe('comprare il pane');

  const list = await page.evaluate(() => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'filo_get_notes' }, (r) => resolve(r));
  }));
  expect(list?.ok).toBe(true);
  expect(list.notes.some((n) => n.text === 'comprare il pane')).toBe(true);

  await page.evaluate((id) => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'filo_delete_note', id }, (r) => resolve(r));
  }), added.note.id);
});
