// Verifica #1685 giro 6, rilievo 2: una proposta rimasta senza risposta, riaperta la chat, ha ancora il bottone per
// confermarla: la riga «Conferma chiesta» non resta una domanda senza modo di rispondere.
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const chatsDellaHome = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)));
const chatCon = async (app, testo) => (await chatsDellaHome(app)).find((c) => c.messages.some((m) => m.text === testo)) || null;

test('r2 comando proposto e mai confermato: riaperta, il bottone per confermarlo c\'è ancora', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('v1685g6-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    const cmd = { id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `mkdir "${join(dir, 'tre')}"`, spiegazione: 'Creo la cartella tre' }) };
    await modelloFinto(app, [{ text: 'Creo la cartella.', toolCalls: [cmd] }, { text: 'Aspetto il tuo OK.' }]);
    await chiedi(page, 'crea la cartella tre');
    await expect(page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Creo la cartella tre' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const chat = await chatCon(app, 'crea la cartella tre');
    await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), chat.id);
    await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chat.id)}`);
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Creo la cartella' })).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Creo la cartella tre' }),
      'riaperta, la conferma ancora da dare ha il suo bottone').toBeVisible({ timeout: 5_000 });
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});
