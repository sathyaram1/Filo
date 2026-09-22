// #567.1/2, terzo giro — due famiglie sulla stessa chat della home.
//
// A) Un'azione che Filo NON esegue perché tocca all'utente finirla (riordina le
//    schede, cancella dall'archivio) viene raccontata come «Azione non
//    riuscita», e quella riga si mangia il bottone: la funzione non si
//    raggiunge più dalla chat.
// B) Quel che l'utente finisce da sé cliccando in chat (il comando confermato
//    nel popup) non entra nel diario del lavoro, che resta «Come ha lavorato».
//    La porta gemella (l'evento di calendario) ce l'ha il secondo giro.

import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, fakeProvider, restore, chiedi } from './aiuto.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';

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

test('chiesto il riordino delle schede, l\'utente deve trovare il bottone per farlo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await fakeProvider(app, [
    { toolCalls: [{ id: 'g3a', name: 'PULISCI_TAB', arguments: '{}' }] },
    { text: 'Valuto le schede aperte.' },
  ], '__v567g3a');

  await chiedi(page, 'riordina le schede e archivia quelle che non servono');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Valuto le schede aperte.' })).toBeVisible({ timeout: 10_000 });

  const d = await diario(page);
  await page.screenshot({ path: 'tests/.shots/567-giro3-riordino-schede.png', fullPage: false });
  const btn = page.locator('.dash-action-btn', { hasText: 'Riordina e archivia' });
  expect(await btn.count(), `il bottone non c'è; il diario dice — titolo: ${JSON.stringify(d.titolo)}, righe: ${JSON.stringify(d.righe)}`).toBeGreaterThan(0);

  await restore(app, '__v567g3a');
});

test('chiesta la cancellazione dall\'archivio, l\'utente deve trovare l\'elenco e la conferma', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await fakeProvider(app, [
    { toolCalls: [{ id: 'g3b', name: 'CANCELLA_ARCHIVIO', arguments: '{"query":"zucca"}' }] },
    { text: 'Cerco nell’archivio.' },
  ], '__v567g3b');

  await chiedi(page, 'cancella definitivamente dall’archivio tutto quello che riguarda la zucca');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Cerco nell’archivio.' })).toBeVisible({ timeout: 10_000 });

  const d = await diario(page);
  const pannello = page.locator('.dash-delete-panel');
  expect(await pannello.count(), `il pannello non c'è; il diario dice — titolo: ${JSON.stringify(d.titolo)}, righe: ${JSON.stringify(d.righe)}`).toBeGreaterThan(0);

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

test('il riordino chiesto da un suggerimento della home deve dire com\'è andato', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();

  // Il riordino vero dipende da quante schede sono aperte: qui conta solo che
  // Filo ne abbia archiviate alcune, non come le ha scelte.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    win._filoTabs.runAutoTriage = async () => ({ archived: 3 });
  });

  // Il suggerimento della home arriva col ricalcolo in background, come dal main.
  const type = await page.evaluate(() => window.SN_MSG.MSG.FILO_DASHBOARD_UPDATED);
  await app.evaluate(({ BrowserWindow }, t) => {
    const msg = {
      type: t,
      message: 'Filo è in ascolto.',
      suggestions: [{ icon: 'web', text: 'Fai pulizia delle schede aperte', action: { type: 'PULISCI_TAB' }, importance: 3 }],
    };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win._filoTabs) continue;
      for (const tab of win._filoTabs.tabs) {
        try { tab.view.webContents.send('filo:broadcast', msg); } catch (_) {}
      }
    }
  }, type);

  const sug = page.locator('.dash-suggestion', { hasText: 'Fai pulizia delle schede' });
  await expect(sug).toBeVisible({ timeout: 10_000 });
  await sug.click();
  await clickConfirm(page, 'ok', { timeout: 10_000 });

  // Tre schede archiviate: l'utente deve leggere da qualche parte che è andata
  // così. Un'azione che non risponde non si distingue da una che non è partita.
  const testo = await page.locator('body').innerText();
  const dice = /archiviat|riordinat|3 schede/i.test(testo);
  expect(dice, 'dopo il riordino chiesto dal suggerimento la home non dice niente di com\'è andato').toBe(true);
});
