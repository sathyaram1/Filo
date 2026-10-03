// Giro 3, rilievo 1: riaperta dall'archivio delle chat, una conversazione in cui
// il riordino e la cancellazione non sono mai stati confermati dice che Filo li ha fatti.
import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, prepara, chiedi } from './_comune.mjs';

test('chat riaperta: riordino e cancellazione mai confermati non risultano fatti', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await prepara(app, [{ title: 'Gatti persiani', gatto: true }, { title: 'Torta', gatto: false }], {
    chiamate: [
      { id: 'p1', name: 'PULISCI_TAB', arguments: '{}' },
      { id: 'c1', name: 'CANCELLA_ARCHIVIO', arguments: '{"query":"gatti"}' },
    ],
  });
  await chiedi(page, 'fai pulizia delle schede e cancella dall\'archivio le pagine sui gatti');
  await expect(page.locator('.dash-delete-list li')).toHaveCount(1, { timeout: 15_000 });
  await expect.poll(() => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => (l[0] && l[0].messages.length) || 0)), { timeout: 5_000 }).toBe(2);
  const id = await app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l[0].id));
  // L'utente non preme niente e torna alla home; più tardi riapre la chat.
  await app.evaluate((_e, chatId) => globalThis.SN_CLOSE_FILO_CHAT(chatId), id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(id)}`);
  await expect(page.locator('.dash-bubble')).toHaveCount(2, { timeout: 8_000 });

  expect(await app.evaluate(async () => (await globalThis.SN_ARCHIVED_TABS.list()).length)).toBe(2);
  const racconto = (await page.locator('.dash-bubble-note[data-replay]').allTextContents()).join(' ');
  expect(racconto).not.toMatch(/eliminato schede/);
  expect(racconto).not.toMatch(/riordinato le schede/);
});
