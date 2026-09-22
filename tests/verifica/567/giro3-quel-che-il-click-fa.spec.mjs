// #567.1, terzo giro — il diario del lavoro racconta solo ciò che Filo ha fatto
// DENTRO il turno. Tutto ciò che l'utente porta a termine da sé cliccando in
// chat non viene scritto da nessuna parte: il riassunto resta «Come ha
// lavorato» e al turno dopo Filo non sa che è successo.
//
// Le porte contate qui sono tre, tutte con quella causa: il riordino delle
// schede, l'eliminazione definitiva dall'archivio e il comando confermato nel
// popup. La quarta (l'evento di calendario) ce l'ha il secondo giro.

import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, fakeProvider, restore, chiedi } from './aiuto.mjs';
import { clickConfirm, fillConfirmInput, CONFIRM_HOST } from '../../helpers/confirm.mjs';

// Il diario: titolo in cima (il riassunto) più le righe dentro il blocco.
async function diario(page) {
  const activity = page.locator('.dash-activity');
  if (!(await activity.count())) return { titolo: '(nessun blocco di lavoro)', righe: [] };
  const titolo = (await activity.locator('.dash-activity-label').first().textContent()) || '';
  await activity.locator('.dash-activity-head').first().click();
  const righe = await activity.locator('.dash-activity-body .dash-activity-row').allTextContents();
  const comandi = await activity.locator('.dash-activity-body .dash-activity-cmd').allTextContents();
  return { titolo: titolo.trim(), righe: [...righe, ...comandi] };
}

test('archiviate le schede col bottone, il diario deve dirlo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  // Il riordino vero dipende da quante schede sono aperte: qui conta solo che
  // Filo ne abbia archiviate alcune, non come le ha scelte.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    win._filoTabs.runAutoTriage = async () => ({ archived: 3 });
  });

  await fakeProvider(app, [
    { toolCalls: [{ id: 'g3a', name: 'PULISCI_TAB', arguments: '{}' }] },
    { text: 'Ecco, valuto le schede aperte.' },
  ], '__v567g3a');

  await chiedi(page, 'riordina le schede e archivia quelle che non servono');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'valuto le schede' })).toBeVisible({ timeout: 10_000 });

  const btn = page.locator('.dash-action-btn', { hasText: 'Riordina e archivia' });
  await expect(btn).toBeVisible();
  await btn.click();
  await clickConfirm(page, 'ok', { timeout: 10_000 });
  await expect(page.locator('.dash-action-btn', { hasText: 'Archiviate 3' })).toBeVisible({ timeout: 10_000 });

  const d = await diario(page);
  const dice = /schede|archiviat/i.test(`${d.titolo} ${d.righe.join(' | ')}`);
  expect(dice, `tre schede archiviate e il diario dice — titolo: ${JSON.stringify(d.titolo)}, righe: ${JSON.stringify(d.righe)}`).toBe(true);

  await restore(app, '__v567g3a');
});

test('eliminate per sempre le schede dall\'archivio, il diario deve dirlo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  // La ricerca nell'archivio vuole un modello di embedding: qui conta il
  // racconto dell'eliminazione, non come l'archivio trova le schede.
  await page.evaluate(() => {
    const orig = chrome.runtime.sendMessage;
    window.__g3b_restore = () => { chrome.runtime.sendMessage = orig; };
    chrome.runtime.sendMessage = (msg, cb) => {
      const t = String((msg && msg.type) || '');
      if (t === 'search_archived_tabs') {
        cb({ ok: true, results: [{ id: 'x1', title: 'Ricette con la zucca', url: 'https://esempio.it/1' }] });
        return undefined;
      }
      if (t === 'delete_archived_tabs') { cb({ ok: true, removed: 1, remaining: 0 }); return undefined; }
      return orig(msg, cb);
    };
  });

  await fakeProvider(app, [
    { toolCalls: [{ id: 'g3b', name: 'CANCELLA_ARCHIVIO', arguments: '{"query":"zucca"}' }] },
    { text: 'Cerco nell’archivio.' },
  ], '__v567g3b');

  await chiedi(page, 'cancella definitivamente dall’archivio tutto quello che riguarda la zucca');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Cerco nell’archivio.' })).toBeVisible({ timeout: 10_000 });

  const del = page.locator('.dash-action-btn-danger');
  await expect(del).toBeVisible({ timeout: 10_000 });
  await del.click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await fillConfirmInput(page, 'conferma');
  await clickConfirm(page, 'danger', { timeout: 10_000 });
  await expect(page.locator('.dash-delete-note', { hasText: 'Eliminate definitivamente' })).toBeVisible({ timeout: 10_000 });

  const d = await diario(page);
  const dice = /elimin|cancellat|archivio/i.test(`${d.titolo} ${d.righe.join(' | ')}`);
  expect(dice, `una scheda eliminata per sempre e il diario dice — titolo: ${JSON.stringify(d.titolo)}, righe: ${JSON.stringify(d.righe)}`).toBe(true);

  await page.evaluate(() => { try { window.__g3b_restore?.(); } catch (_) {} });
  await restore(app, '__v567g3b');
});

test('eseguito il comando confermato nel popup, il diario deve contarlo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } });
  });

  const cartella = `/tmp/filo-v567-g3-${Date.now()}`;
  await fakeProvider(app, [
    { toolCalls: [{ id: 'g3c', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `mkdir ${cartella}` }) }] },
    { text: 'Creo la cartella.' },
  ], '__v567g3c');

  await chiedi(page, `crea la cartella ${cartella}`);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Creo la cartella.' })).toBeVisible({ timeout: 10_000 });

  const btn = page.locator('.dash-bubble-actions .dash-action-btn').first();
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await btn.click();
  await clickConfirm(page, 'ok', { timeout: 10_000 });
  await expect(btn).toContainText('✓', { timeout: 15_000 });

  const d = await diario(page);
  const dice = /comando|eseguit|mkdir/i.test(`${d.titolo} ${d.righe.join(' | ')}`);
  expect(dice, `comando eseguito sul computer e il diario dice — titolo: ${JSON.stringify(d.titolo)}, righe: ${JSON.stringify(d.righe)}`).toBe(true);

  await restore(app, '__v567g3c');
});
