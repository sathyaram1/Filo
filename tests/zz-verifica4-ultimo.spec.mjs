// VERIFICA indipendente (temporaneo): ragionamento fra turni, note multiple.
import { test, expect } from './fixtures/electron.mjs';
import { newtabPage, setup, ask, activityRows } from './zz-verifica4-base.spec.mjs';

test('il ragionamento strutturato torna al modello al turno DOPO', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    { text: 'Ci ho pensato.', reasoningDetails: [{ type: 'reasoning.text', text: 'catena di pensiero' }] },
    { text: 'Ancora qui.' },
  ]);
  await ask(page, 'pensaci');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Ci ho pensato', { timeout: 20_000 });
  await ask(page, 'e adesso?');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Ancora qui', { timeout: 20_000 });
  const calls = await app.evaluate(() => globalThis.__v.calls);
  const secondo = calls[1].messages;
  const asst = secondo.filter((m) => m.role === 'assistant');
  console.log('RAGIONAMENTO-TURNO-DOPO', JSON.stringify(asst));
  expect(JSON.stringify(asst)).toContain('catena di pensiero');
});

test('tre giri con testo: tre note nel blocco, nell\'ordine, e una sola bolla', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    { text: 'Prima cerco.', toolCalls: [{ id: 'a', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'uno' }) }] },
    { text: 'Poi il timer.', toolCalls: [{ id: 'b', name: 'TIMER', arguments: JSON.stringify({ secondi: 60, etichetta: 'x' }) }] },
    { text: 'Infine la sveglia.', toolCalls: [{ id: 'c', name: 'SVEGLIA', arguments: JSON.stringify({ time: '07:00' }) }] },
    { text: 'Ecco la risposta finale.' },
  ]);
  await ask(page, 'fai tutto');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('risposta finale', { timeout: 25_000 });
  const act = await activityRows(page);
  console.log('TRE-GIRI', JSON.stringify(act));
  expect(act.notes).toEqual(['Prima cerco.', 'Poi il timer.', 'Infine la sveglia.']);
  expect(act.rows.length).toBe(3);
  expect(await page.locator('.dash-bubble-filo').count()).toBe(1);
  const ordine = await page.evaluate(() => Array.from(document.querySelector('.dash-activity-body').children).map((c) => c.className.split(' ').pop() + ':' + c.textContent.slice(0, 24)));
  console.log('ORDINE', JSON.stringify(ordine));
});
