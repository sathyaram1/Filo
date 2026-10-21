// #1130 giro 5, r1: un turno chiuso sulla conferma, senza frase, deve restare nella conversazione: la chat riaperta
// mostra la risposta di Filo a quel messaggio, e al messaggio dopo il modello sa cosa aveva proposto.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';

const ultimaChat = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)[0]));

test('r1 la proposta ferma sulla conferma resta nella chat riaperta e nel contesto del messaggio dopo', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await livelloAutonomia(app, 'conservativo');
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'f1', name: 'INVIA_FEEDBACK', arguments: '{"testo":"Il timer non suona.","titolo":"Timer muto"}' }] },
    { text: 'Te lo mando appena confermi.' },
  ]);
  await chiedi(page, 'segnala che il timer non suona');
  await expect(page.locator('.dash-action-btn', { hasText: 'Inviare questo feedback' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#sendBtn')).toBeVisible();
  await expect.poll(async () => ((await ultimaChat(app)) || { messages: [] }).messages.length, { timeout: 5_000 }).toBe(2);
  const chat = await ultimaChat(app);
  const prima = (await chiamateAlModello(app)).length;

  // L'utente non conferma, chiude la chat e la riapre.
  await app.evaluate((_e, chatId) => globalThis.SN_CLOSE_FILO_CHAT(chatId), chat.id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chat.id)}`);
  await expect(page.locator('.dash-bubble-user', { hasText: 'segnala che il timer non suona' })).toBeVisible({ timeout: 8_000 });
  await expect.soft(page.locator('.dash-bubble-filo'), 'riaperta, la chat mostra la risposta di Filo a quel messaggio').toHaveCount(1, { timeout: 3_000 });

  // Il messaggio dopo si riferisce alla proposta: il modello deve sapere di averla fatta.
  await chiedi(page, 'aggiungi che succede col volume basso');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBeGreaterThan(prima);
  const ch = await chiamateAlModello(app);
  const storia = ch[ch.length - 1];
  const i = storia.findIndex((m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('segnala che il timer non suona'));
  const turnoChiuso = storia.slice(i + 1).find((m) => m.role === 'assistant');
  expect(turnoChiuso && turnoChiuso.content, 'il turno chiuso sulla conferma dice al modello cosa aveva proposto').toMatch(/INVIA_FEEDBACK|feedback|conferm/i);
  await ripristina(app);
});
