// Verifica #1685 giro 6, rilievo 1: un comando partito e non riuscito, riaperta la chat dopo un riavvio, non si legge
// «non eseguito» e porta il suo perché, alla chat e al modello.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';

const chatsDellaHome = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)));
const chatCon = async (app, testo) => (await chatsDellaHome(app)).find((c) => c.messages.some((m) => m.text === testo)) || null;

test('r1 comando che esce con errore: riaperta dopo un riavvio, la riga e il modello dicono che è partito e perché non è riuscito', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: '{"comando":"ls /cartella-inesistente-1685","spiegazione":"Elenco i file"}' }] },
    { text: 'Non è andata.' },
    { text: 'Ok.' },
  ]);
  const domanda = 'elenca i file di /cartella-inesistente-1685';
  await chiedi(page, domanda);
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await chatCon(app, domanda))?.messages.length || 0, { timeout: 8_000 }).toBeGreaterThan(1);
  const chat = await chatCon(app, domanda);
  await app.evaluate((_e, c) => globalThis.SN_CONTESTO_FILO.dimentica(c), chat.id);
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), chat.id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chat.id)}`);
  const riga = page.locator('.dash-bubble-filo .dash-activity-row');
  await expect(riga).toHaveCount(1, { timeout: 8_000 });
  await expect(riga, 'il comando è partito: non si legge «non eseguito»').not.toContainText('non eseguito');
  await expect(riga, 'riaperta, la riga dice perché non è riuscito').toContainText(/No such file|uscita 2/);

  await chiedi(page, 'quel comando è partito?');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBe(3);
  const st = (await chiamateAlModello(app))[2];
  const detto = st.filter((m) => m.role === 'assistant').map((m) => String(m.content)).join('\n');
  expect(detto, 'dopo un riavvio il modello sa perché non è riuscito').toMatch(/NON riuscita[^\n]*(No such file|uscita 2)/);
  await ripristina(app);
});
