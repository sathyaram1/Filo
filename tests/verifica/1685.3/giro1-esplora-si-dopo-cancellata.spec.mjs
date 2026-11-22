// Esplorazione #1685.3 giro 1: un sì dato dopo che la conversazione del bottone è stata cancellata non fa nascere
// nessuna conversazione, nemmeno con un altro id per la risposta con cui Filo riprende.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { clickConfirm, scrollConfirmToEnd, fillConfirmInput, CONFIRM_HOST } from '../../helpers/confirm.mjs';

const chatsDellaHome = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)));
const chatCon = async (app, testo) => (await chatsDellaHome(app)).find((c) => c.messages.some((m) => m.text === testo)) || null;
const TERMINALE = { id: 'p1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"modalita_terminale","valore":true}' };

test('un sì dopo la cancellazione: nessuna conversazione nuova, e la ripresa non scrive da nessuna parte', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: false } }));
  await modelloFinto(app, [{ text: '', toolCalls: [TERMINALE] }, { text: 'Acceso, ora puoi lanciare comandi.' }]);
  await chiedi(page, 'accendi il terminale');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await clickConfirm(page, 'cancel');
  await expect.poll(async () => (await chatCon(app, 'accendi il terminale'))?.messages.flatMap((m) => m.esiti || []).length, { timeout: 8_000 }).toBe(1);
  const nata = await chatCon(app, 'accendi il terminale');
  const prima = (await chatsDellaHome(app)).length;
  await page.locator('.dash-bubble-filo .dash-action-btn-primary').click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await page.evaluate((id) => chrome.runtime.sendMessage({ type: 'filo_chat_delete', id }), nata.id);
  await expect.poll(async () => (await chatsDellaHome(app)).some((c) => c.id === nata.id), { timeout: 5_000 }).toBe(false);
  await fillConfirmInput(page, 'conferma');
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'danger');
  await expect.poll(() => app.evaluate(() => globalThis.SN_STORAGE.getSettings().then((s) => s.terminal && s.terminal.enabled)), { timeout: 10_000 }).toBe(true);
  await page.waitForTimeout(3000);
  const dopo = await chatsDellaHome(app);
  console.log('chiamate al modello:', (await chiamateAlModello(app)).length, 'chat prima:', prima, 'dopo:', dopo.length);
  console.log(JSON.stringify(dopo.map((c) => ({ id: c.id, m: c.messages.map((m) => [m.role, m.text, (m.esiti || []).length]) }))));
  expect(dopo.length, 'nessuna conversazione nuova').toBe(prima - 1);
  await ripristina(app);
});
