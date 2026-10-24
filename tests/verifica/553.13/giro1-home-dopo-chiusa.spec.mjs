// #553.13 giro 1: chiusa la conversazione nata da «portami alla home», la home (la stessa ricaricata, una nuova)
// mostra lo scambio nel filo una volta sola e il messaggio dopo ne comincia un'altra.
import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, fakeProvider, restore, chiedi } from '../567/aiuto.mjs';

const chatDi = (app, testo) => app.evaluate(async (_electron, t) => (await globalThis.SN_IL_FILO.chats())
  .filter((c) => c.messages.some((m) => m.text === t)).map((c) => c.id), testo);

async function chiudiDallaHome(app, page, slot) {
  await fakeProvider(app, [
    { toolCalls: [{ id: 'h1', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' }], text: 'Sei già qui, nella home.' },
    { text: 'Sei già qui, nella home.' },
  ], slot);
  await chiedi(page, 'portami alla home');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sei già qui' })).toBeVisible({ timeout: 10_000 });
  const btn = page.locator('.dash-action-btn', { hasText: 'Chiudi la conversazione' });
  await btn.dblclick();
  await expect(page.locator('.dash-action-btn', { hasText: 'Conversazione chiusa' })).toBeDisabled();
  await restore(app, slot);
}

test('la home ricaricata dopo la chiusura mostra lo scambio una volta, e non offre di richiuderlo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await chiudiDallaHome(app, page, '__v55313a');
  const [chiusa] = await chatDi(app, 'portami alla home');
  await expect.poll(() => app.evaluate(async (_electron, id) => (await globalThis.SN_IL_FILO.chats()).find((c) => c.id === id)?.finita, chiusa)).toBe(true);

  await page.reload();
  await expect(page.locator('#input')).toBeVisible();
  await expect(page.locator('#bubbles .dash-bubble-user', { hasText: 'portami alla home' })).toHaveCount(1);
  await expect(page.locator('#bubbles .dash-bubble-filo', { hasText: 'Sei già qui' })).toHaveCount(1);
  await expect(page.locator('.dash-action-btn', { hasText: 'Chiudi la conversazione' })).toHaveCount(0);
  await page.screenshot({ path: 'tests/.shots/v55313-ricaricata.png' });
});

test('due conversazioni chiuse di fila: la scheda nuova le mostra tutte e due, ciascuna una volta', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await chiudiDallaHome(app, page, '__v55313b');
  await fakeProvider(app, [{ text: 'Di niente, davvero.' }], '__v55313c');
  await chiedi(page, 'grazie mille');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Di niente, davvero.' })).toBeVisible({ timeout: 10_000 });
  await restore(app, '__v55313c');
  await expect.poll(() => chatDi(app, 'grazie mille')).toHaveLength(1);
  const [prima] = await chatDi(app, 'portami alla home');
  expect(await chatDi(app, 'grazie mille')).not.toContain(prima);

  const nuova = await openTab('filo://newtab/');
  await expect(nuova.locator('#input')).toBeVisible();
  await expect(nuova.locator('#bubbles .dash-bubble-user', { hasText: 'portami alla home' })).toHaveCount(1);
  await expect(nuova.locator('#bubbles .dash-bubble-user', { hasText: 'grazie mille' })).toHaveCount(1);
  await expect(nuova.locator('#bubbles .dash-bubble-filo', { hasText: 'Di niente, davvero.' })).toHaveCount(1);
  await nuova.screenshot({ path: 'tests/.shots/v55313-scheda-nuova.png' });
});
