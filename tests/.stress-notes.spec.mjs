import { test, expect } from './fixtures/electron.mjs';
import { clickConfirm } from './helpers/confirm.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}
async function addNote(page, text, context) {
  return page.evaluate(([t, c]) => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.FILO_ADD_NOTE, text: t, context: c }, (r) => resolve(r));
  }), [text, context]);
}
async function getNotes(page) {
  return page.evaluate(() => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.FILO_GET_NOTES }, (r) => resolve(r));
  }));
}

test('stato vuoto: pannello mostra il messaggio vuoto, niente footer', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await page.locator('.dash-ctrl[data-command="notes"]').click();
  await expect(page.locator('.dash-notes-box')).toBeVisible();
  await expect(page.locator('.dash-notes-empty')).toBeVisible();
  await expect(page.locator('.dash-notes-footer')).toBeHidden();
  await expect(page.locator('.dash-notes-item')).toHaveCount(0);
});

test('XSS: script/HTML nel testo e nel contesto non esegue ed è reso come testo', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  let alerted = false;
  page.on('dialog', async (d) => { alerted = true; await d.dismiss(); });
  const XSS = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  await addNote(page, XSS, '<b>ctx</b><script>alert(3)</script>');
  await page.locator('.dash-ctrl[data-command="notes"]').click();
  const item = page.locator('.dash-notes-item').first();
  await expect(item).toBeVisible();
  // Il testo compare letteralmente (textContent), nessun <img>/<script> reale iniettato.
  await expect(page.locator('.dash-notes-text').first()).toHaveText(XSS);
  expect(await page.locator('.dash-notes-item img, .dash-notes-item script').count()).toBe(0);
  await page.waitForTimeout(300);
  expect(alerted).toBe(false);
});

test('emoji, testo lungo 10k, doppio-click elimina: robusto', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  const EMOJI = '📝🔥 nota con emoji e accenti àèìòù';
  const LONG = 'X'.repeat(10_000);
  await addNote(page, EMOJI, '');
  await addNote(page, LONG, '');
  await addNote(page, '   ', ''); // solo spazi → deve essere rifiutato dal backend
  const notes = await getNotes(page);
  // solo spazi non salvato: restano 2
  expect((notes?.notes || []).length).toBe(2);

  await page.locator('.dash-ctrl[data-command="notes"]').click();
  await expect(page.locator('.dash-notes-item')).toHaveCount(2);
  await expect(page.locator('.dash-notes-box')).toContainText('emoji');

  // Doppio click rapido sullo STESSO × (stesso elemento fisico prima del
  // re-render): il bottone si disabilita → un solo appunto eliminato, l'altro resta.
  const firstItem = page.locator('.dash-notes-item').first();
  const del = firstItem.locator('.dash-notes-del');
  await del.dblclick();
  await expect(page.locator('.dash-notes-item')).toHaveCount(1);

  // Cancella tutti → vuoto
  await page.locator('.dash-notes-clear').click();
  await clickConfirm(page, 'ok');
  await expect(page.locator('.dash-notes-empty')).toBeVisible();
  expect(((await getNotes(page))?.notes || []).length).toBe(0);
});

test('apri/chiudi ripetuto con Esc e X non lascia overlay orfani', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  const btn = page.locator('.dash-ctrl[data-command="notes"]');
  for (let i = 0; i < 4; i++) {
    await btn.click();
    await expect(page.locator('.dash-notes-box')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.dash-notes-overlay')).toHaveCount(0);
  }
  // Click esterno chiude
  await btn.click();
  await expect(page.locator('.dash-notes-box')).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(page.locator('.dash-notes-overlay')).toHaveCount(0);
  // Il guard notesOverlayOpen non deve MAI creare due overlay contemporanei.
  // (un secondo mousedown sul backdrop può chiudere il primo → count 0 o 1, mai 2)
  await btn.click();
  await btn.click({ force: true }).catch(() => {});
  const n = await page.locator('.dash-notes-overlay').count();
  expect(n).toBeLessThanOrEqual(1);
});
