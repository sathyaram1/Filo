// Un riordino confermato che finisce dopo il ritorno alla home va nella chat dove è stato chiesto, non in una chat nuova.
import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';
import { newtabPage, configure, fakeChat, chiedi } from './_comune.mjs';

test('riordino confermato, poi /home mentre lavora: niente chat fantasma, la chat di partenza lo racconta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] }));
  await configure(app);
  await fakeChat(app, [
    { toolCalls: [{ id: 'p1', name: 'PULISCI_TAB', arguments: '{}' }] },
    { text: 'Valuto le schede.' },
  ]);
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w._filoTabs) w._filoTabs.runAutoTriage = async () => { await new Promise((r) => setTimeout(r, 2500)); return { archived: 2 }; };
    }
  });
  await chiedi(page, 'fai pulizia delle schede');
  const btn = page.locator('.dash-action-btn', { hasText: 'Riordina e archivia le schede' });
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await btn.click();
  await clickConfirm(page, 'ok');
  await expect(page.locator('.dash-action-btn', { hasText: 'Riordino in corso' })).toBeVisible();
  await chiedi(page, '/home');
  await new Promise((r) => setTimeout(r, 3500));

  const chats = await app.evaluate(() => globalThis.SN_FILO_CHATS.list());
  const fantasma = chats.filter((c) => !c.messages.some((m) => m.role === 'user'));
  expect(fantasma, 'una chat senza nessuna domanda dell\'utente è comparsa in Cronologia').toEqual([]);
  const partenza = chats.find((c) => c.messages.some((m) => m.text === 'fai pulizia delle schede'));
  expect(partenza.messages.flatMap((m) => m.actions || [])).toContain('PULISCI_TAB');
});
