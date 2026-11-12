// Verifica #1685 giro 1, rilievo 1: riaperta, la chat racconta le azioni fatte con le parole e i numeri del diario in
// diretta («Timer avviato · Pasta · 5 min»), non con l'infinito della proposta («Avviare il timer «Pasta»»).
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';

const chatsDellaHome = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)));
const chatCon = async (app, testo) => (await chatsDellaHome(app)).find((c) => c.messages.some((m) => m.text === testo)) || null;

test('r1 riaperta, la riga del timer dice che è avviato e quanto dura, e il modello legge la durata', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 't1', name: 'TIMER', arguments: '{"secondi":300,"etichetta":"Pasta"}' }] },
    { text: 'Timer partito.' },
    { text: 'Ok.' },
  ]);
  await chiedi(page, 'timer di cinque minuti per la pasta');
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await chatCon(app, 'timer di cinque minuti per la pasta'))?.messages.length || 0, { timeout: 10_000 }).toBeGreaterThan(1);
  const chat = await chatCon(app, 'timer di cinque minuti per la pasta');
  await app.evaluate((_e, c) => globalThis.SN_CONTESTO_FILO.dimentica(c), chat.id);
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), chat.id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chat.id)}`);
  const riga = page.locator('.dash-bubble-filo .dash-activity-row', { hasText: 'Pasta' });
  await expect(riga).toBeVisible({ timeout: 8_000 });
  await expect(riga, 'la riga racconta una cosa fatta, coi suoi numeri').toHaveText(/Timer avviato.*Pasta.*5 min/);

  const prima = (await chiamateAlModello(app)).length;
  await chiedi(page, 'quanto durava il timer?');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBeGreaterThan(prima);
  const ch = await chiamateAlModello(app);
  expect(JSON.stringify(ch[ch.length - 1]), 'dopo un riavvio il modello sa quanto durava').toMatch(/fatta: [^\n]*Pasta[^\n]*5 min/);
  await ripristina(app);
});
