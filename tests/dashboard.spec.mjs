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

test('tasto destro sulla dashboard apre il menu Filo', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  // I content script vengono iniettati anche su filo://newtab/ via
  // internal-preload, quindi il menu Filo deve apparire.
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1',
    null,
    { timeout: 8_000 },
  );
  await page.locator('#center').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 5_000 });
});

test('la dashboard renderizza le tre zone + barra input', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  await expect(page.locator('#center')).toBeVisible();
  await expect(page.locator('#left')).toBeAttached();
  await expect(page.locator('#right')).toBeAttached();
  await expect(page.locator('#input')).toBeVisible();
  await expect(page.locator('#sendBtn')).toBeVisible();
  // Impostazioni/Home sono nella toolbar della shell, non nella dashboard.
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home');
  await expect(page.locator('#threadView')).toBeHidden();
});

test('senza API key la home invita a registrarsi con un profilo (non a mettere una chiave)', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  // Il messaggio "Filo non è attivo" è quello prodotto dal main quando non c'è
  // nessuna chiave risolvibile (test isolato: né chiavi utente né default) — è
  // la parte che il feedback #356 riguarda. Lo leggiamo direttamente dall'IPC,
  // non dal DOM, perché alla primissima apertura la home mostra il messaggio di
  // benvenuto e non il messaggio della dashboard.
  const r = await page.evaluate(() => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'filo_generate_dashboard', force: true }, (res) => resolve(res));
  }));
  expect(r?.ok).toBe(true);
  const txt = String(r.message || '');
  expect(txt.length).toBeGreaterThan(0);
  // Feedback #356: l'opzione consigliata deve essere registrarsi con un profilo
  // (gratis, senza chiavi), non "imposta una chiave API" come prima scelta. Il
  // profilo deve comparire PRIMA di qualsiasi menzione della chiave.
  expect(txt.toLowerCase()).toContain('profilo');
  const iProfilo = txt.toLowerCase().indexOf('profilo');
  const iChiave = txt.toLowerCase().indexOf('chiave');
  if (iChiave !== -1) expect(iProfilo).toBeLessThan(iChiave);
  // La vecchia formulazione che spingeva la chiave come attivazione non deve tornare.
  expect(txt).not.toContain('Imposta una chiave API nelle Opzioni per attivare Filo');
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

// Gli appunti non hanno più un archivio proprio da leggere/scrivere via
// messaggi: Filo li scrive nei file dell'editor. Il percorso vero è coperto da
// audit-notes-visibility.spec.mjs (Filo scrive → il testo compare nell'editor) e
// da editor-notes-migration.spec.mjs (gli appunti storici finiscono nell'editor).
