// VERIFICA indipendente (temporaneo): il blocco di attività sul tema scuro.
import { test, expect } from './fixtures/electron.mjs';
import { newtabPage, setup, ask } from './zz-verifica4-base.spec.mjs';

test('tema scuro: blocco aperto leggibile', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    { toolCalls: [{ id: 'q0', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'tema', valore: 'scuro' }) }] },
    { text: 'Buio fatto.' },
    {
      reasoning: ['Rifletto un momento. '],
      text: 'Metto tutto.',
      toolCalls: [
        { id: 'q1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'ricette' }) },
        { id: 'q2', name: 'TIMER', arguments: JSON.stringify({ secondi: 600, etichetta: 'forno' }) },
        { id: 'q3', name: 'LEGGI_DOCUMENTO', arguments: JSON.stringify({ percorso: '~/nope.pdf' }) },
      ],
    },
    { text: 'Ecco fatto: il forno è avviato.' },
  ]);
  await ask(page, 'metti il tema scuro');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Buio fatto', { timeout: 20_000 });
  await page.waitForTimeout(600);
  await ask(page, 'cerca ricette, timer forno e leggi il pdf');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Ecco fatto', { timeout: 20_000 });
  await page.locator('.dash-activity-head').last().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/zzv4-scuro.png' });
});
