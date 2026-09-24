// #567, quinto giro — altre due porte della famiglia del quarto giro: la
// conversazione riaperta conosce solo il NOME delle azioni, mai il loro esito.
//
// Qui il comando che non è mai partito (modalità terminale spenta) e il comando
// della finestra che non ha fatto niente («Sei già nella home»): tutti e due si
// rileggono come riusciti.

import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, fakeProvider, restore, chiedi } from './aiuto.mjs';

const archivio = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list());

async function chatConAzione(app, tipo) {
  for (let i = 0; i < 40; i += 1) {
    const c = await archivio(app);
    if (c.length && c[0].messages.some((m) => Array.isArray(m.actions) && m.actions.includes(tipo))) return c[0];
    await new Promise((r) => setTimeout(r, 250));
  }
  const c = await archivio(app);
  return c[0] || null;
}

async function noteRiaperte(openTab, id) {
  const riaperta = await openTab(`filo://dashboard/dashboard.html?chat=${id}`);
  await expect(riaperta.locator('.dash-bubble').first()).toBeVisible({ timeout: 10_000 });
  return (await riaperta.locator('.dash-bubble-note[data-replay="1"]').allTextContents()).join(' | ');
}

test('il comando mai partito si rilegge come eseguito nella conversazione riaperta', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] }));

  // La modalità terminale è spenta (è il valore di serie): il comando non parte.
  await fakeProvider(app, [
    { toolCalls: [{ id: 'g5c', name: 'ESEGUI_COMANDO', arguments: '{"comando":"ls -la"}' }] },
    { text: 'Ecco.' },
  ], '__v567g5c');

  await chiedi(page, 'elenca i file');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco.' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.dash-cmd-blocked')).toBeVisible();

  const chat = await chatConAzione(app, 'ESEGUI_COMANDO');
  expect(chat, 'la chat non è arrivata nell\'archivio').toBeTruthy();
  const note = await noteRiaperte(openTab, chat.id);

  expect(note, 'la chat riaperta non racconta niente di quel turno').not.toBe('');
  expect(
    note,
    `il comando non è mai partito, e la chat riaperta racconta: ${JSON.stringify(note)}`,
  ).not.toMatch(/eseguito un comando/i);

  await restore(app, '__v567g5c');
});

test('la home chiesta dalla home si rilegge come un comando azionato', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] }));

  await fakeProvider(app, [
    { toolCalls: [{ id: 'g5d', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' }] },
    { text: 'Sei già qui.' },
  ], '__v567g5d');

  await chiedi(page, 'portami alla home');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sei già qui.' })).toBeVisible({ timeout: 15_000 });
  // In diretta il diario è onesto: il comando non ha agito e non entra nel riassunto.
  const titolo = ((await page.locator('.dash-activity .dash-activity-label').first().textContent()) || '').trim();
  expect(titolo, 'in diretta il riassunto non deve vantare un comando che non ha agito').not.toMatch(/azionato un comando/i);

  const chat = await chatConAzione(app, 'COMANDO_FINESTRA');
  expect(chat, 'la chat non è arrivata nell\'archivio').toBeTruthy();
  const note = await noteRiaperte(openTab, chat.id);

  expect(note, 'la chat riaperta non racconta niente di quel turno').not.toBe('');
  expect(
    note,
    `la home era già aperta e non è successo niente, ma la chat riaperta racconta: ${JSON.stringify(note)}`,
  ).not.toMatch(/azionato un comando della finestra/i);

  await restore(app, '__v567g5d');
});
