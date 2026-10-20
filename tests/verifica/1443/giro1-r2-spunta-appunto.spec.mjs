// Verifica #1443: la spunta sotto un appunto salvato in chat («Chiudi e torna alla dashboard») chiude la conversazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, fakeProvider, chatDi } from './aiuti.mjs';

test('r2 la spunta dopo un appunto salvato chiude la conversazione', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await fakeProvider(app, [
    { toolCalls: [{ id: 'a1', name: 'SALVA_APPUNTO', arguments: '{"testo":"comprare il latte","contesto":"spesa"}' }] },
    { text: 'Segnato.' },
    { text: 'Di niente.' },
  ]);
  await page.locator('#input').fill('ricordami di comprare il latte');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Segnato.' })).toBeVisible({ timeout: 10_000 });
  const spunta = page.locator('.dash-action-btn[title="Chiudi e torna alla dashboard"]');
  await expect(spunta).toHaveCount(1);
  await spunta.click();
  await page.waitForTimeout(800);
  await page.locator('#input').fill('grazie');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Di niente.' })).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => chatDi(app, 'grazie')).toHaveLength(1);
  const [prima] = await chatDi(app, 'ricordami di comprare il latte');
  expect(await chatDi(app, 'grazie'), 'dopo la spunta il messaggio continua la conversazione dell’appunto').not.toContain(prima);
});
