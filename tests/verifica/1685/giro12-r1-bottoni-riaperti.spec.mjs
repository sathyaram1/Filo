// Giro 12 di #1685: riaperta la chat, i bottoni cliccabili di una risposta tornano tutti, non solo file, eventi e conferme.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

const chatsDellaHome = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)));
const chatCon = async (app, testo) => (await chatsDellaHome(app)).find((c) => c.messages.some((m) => m.text === testo)) || null;
const dimenticaLaMemoria = (app, id) => app.evaluate((_e, c) => globalThis.SN_CONTESTO_FILO.dimentica(c), id);
async function riapri(app, page, id) {
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(id)}`);
}

test('r1 la pagina aperta da Filo: riaperta la chat, il collegamento per riaprirla c\'è ancora', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  const url = testServer.html('<title>Posta</title><h1>Posta</h1>');
  await modelloFinto(app, [{ text: 'Ecco la posta.', toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url, etichetta: 'Posta' }) }] }, { text: '' }]);
  await chiedi(page, 'apri la posta');
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 10_000 });
  await page.bringToFront();
  await expect(page.locator('.dash-bubble-filo .dash-action-link-chip')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  const chat = await chatCon(app, 'apri la posta');
  await dimenticaLaMemoria(app, chat.id);
  await riapri(app, page, chat.id);
  await expect(page.locator('.dash-bubble-user', { hasText: 'apri la posta' })).toBeVisible({ timeout: 8_000 });
  await page.screenshot({ path: 'tests/.shots/giro12-r1-link-riaperto.png' });
  await expect(page.locator('.dash-bubble-filo .dash-action-link-chip'), 'riaperta, il collegamento alla pagina si clicca ancora').toHaveCount(1);
  await ripristina(app);
});

test('r1 l\'appunto salvato da Filo: riaperta la chat, il bottone che apre l\'editor c\'è ancora', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Segnato.', toolCalls: [{ id: 'a1', name: 'SALVA_APPUNTO', arguments: '{"testo":"comprare il latte","contesto":"spesa"}' }] }, { text: '' }]);
  await chiedi(page, 'segnati di comprare il latte');
  await expect(page.locator('.dash-bubble-filo [data-action="openNotes"]')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  const chat = await chatCon(app, 'segnati di comprare il latte');
  await dimenticaLaMemoria(app, chat.id);
  await riapri(app, page, chat.id);
  await expect(page.locator('.dash-bubble-user', { hasText: 'segnati di comprare il latte' })).toBeVisible({ timeout: 8_000 });
  await page.screenshot({ path: 'tests/.shots/giro12-r1-appunto-riaperto.png' });
  await expect(page.locator('.dash-bubble-filo [data-action="openNotes"]'), 'riaperta, l\'appunto si apre ancora dal suo bottone').toHaveCount(1);
  await ripristina(app);
});
