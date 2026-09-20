// #567.3 — «portami alla home» chiesto mentre si è GIÀ nella home non deve
// buttare via il blocco del lavoro e la risposta: l'utente non farebbe in
// tempo a leggere cosa Filo ha fatto e cosa aveva da dire.
//
// Le porte contate qui: la home chiesta insieme ad altro lavoro; la home
// chiesta da sola; il ritorno alla home quando lo decide l'utente; gli altri
// comandi di finestra, che non devono ricaricare niente nemmeno loro.

import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, fakeProvider, restore, chiedi } from './aiuto.mjs';

test('la home chiesta a metà lavoro non ricarica la pagina: lavoro e risposta restano da leggere', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  // Testimone: se la home si ricarica, sparisce.
  await page.evaluate(() => { window.__v567 = 'vivo'; });

  await fakeProvider(app, [
    {
      toolCalls: [
        { id: 'h0', name: 'TIMER', arguments: '{"secondi":300,"etichetta":"pasta"}' },
        { id: 'h1', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' },
      ],
    },
    { text: 'Timer avviato: sei già nella home.' },
  ], '__v567h');

  await chiedi(page, 'metti un timer di 5 minuti e portami alla home');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'sei già nella home' })).toBeVisible({ timeout: 10_000 });

  // La pagina non è stata ricaricata.
  expect(await page.evaluate(() => window.__v567 || '')).toBe('vivo');

  // Il blocco del lavoro c'è ancora, e dice cosa è successo.
  const activity = page.locator('.dash-activity');
  await expect(activity).toHaveCount(1);
  await activity.locator('.dash-activity-head').click();
  await expect(activity.locator('.dash-activity-body .dash-activity-row', { hasText: 'Timer avviato' })).toHaveCount(1);
  await expect(activity.locator('.dash-activity-body .dash-activity-row', { hasText: 'Sei già nella home' })).toHaveCount(1);

  // E tornarci lo decide l'utente, dopo aver letto.
  const torna = page.locator('.dash-action-btn', { hasText: 'Torna alla home' });
  await expect(torna).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/567-home-a-meta-lavoro.png' });
  await torna.click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'sei già nella home' })).toHaveCount(0, { timeout: 8_000 });

  await restore(app, '__v567h');
});

test('la home chiesta da sola lascia comunque leggere la risposta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await page.evaluate(() => { window.__v567b = 'vivo'; });

  await fakeProvider(app, [
    { toolCalls: [{ id: 'h2', name: 'COMANDO_FINESTRA', arguments: '{"comando":"home"}' }] },
    { text: 'Ci sei già.' },
  ], '__v567i');

  await chiedi(page, 'portami alla home');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ci sei già.' })).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => window.__v567b || '')).toBe('vivo');
  await expect(page.locator('.dash-action-btn', { hasText: 'Torna alla home' })).toBeVisible();

  await restore(app, '__v567i');
});

test('gli altri comandi della finestra non portano via la conversazione', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await page.evaluate(() => { window.__v567c = 'vivo'; });

  await fakeProvider(app, [
    { toolCalls: [{ id: 'h3', name: 'COMANDO_FINESTRA', arguments: '{"comando":"settings"}' }] },
    { text: 'Aperte.' },
  ], '__v567l');

  await chiedi(page, 'apri le impostazioni');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Aperte.' })).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => window.__v567c || '')).toBe('vivo');
  await expect(page.locator('.dash-activity')).toHaveCount(1);

  await restore(app, '__v567l');
});
