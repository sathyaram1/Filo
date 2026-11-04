// Verifica #1685 giro 5, rilievo 2: un evento proposto e non ancora aggiunto, riaperta la chat, ha ancora il suo
// bottone «Aggiungi al calendario».
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

const chatsDellaHome = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)));
const chatCon = async (app, testo) => (await chatsDellaHome(app)).find((c) => c.messages.some((m) => m.text === testo)) || null;

test('r2 evento proposto e non cliccato: riaperta, il bottone per aggiungerlo c\'è ancora', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modelloFinto(app, [
    { text: 'Ecco l\'evento.', toolCalls: [{ id: 'e1', name: 'EVENTO_CALENDARIO', arguments: '{"data":"2026-12-02","ora":"10:00","titolo":"Dentista"}' }] },
    { text: 'Ok.' },
  ]);
  await chiedi(page, 'metti il dentista il due dicembre');
  await expect(page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'calendario' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  const chat = await chatCon(app, 'metti il dentista il due dicembre');
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), chat.id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chat.id)}`);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco l\'evento.' })).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'calendario' }), 'riaperta, l\'evento si aggiunge ancora col bottone').toBeVisible({ timeout: 5_000 });
  await ripristina(app);
});
