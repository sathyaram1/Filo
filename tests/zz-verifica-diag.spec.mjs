import { test, expect } from './fixtures/electron.mjs';
import { newtabPage, configureModel, installScript, dumpChat } from './zz-verifica-helpers.mjs';

const R1 = { reasoningDetails: [{ type: 'reasoning.text', text: 'Devo cercare e leggere.' }],
  toolCalls: [
    { id: 'call_1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'meteo Roma domani' }) },
    { id: 'call_2', name: 'CAPACITA_DETTAGLIO', arguments: JSON.stringify({ ids: ['translate-page'] }) },
  ], delayMs: 1200 };
const VARIANTS = {
  timerOnly: [{ toolCalls: [{ id: 'c1', name: 'TIMER', arguments: '{"secondi":600,"etichetta":"pasta"}' }], delayMs: 1200 }, { text: 'FINE-DIAG' }],
  noReasoning: [{ ...R1, reasoningDetails: undefined }, { text: 'FINE-DIAG' }],
  cercaOnly: [{ ...R1, reasoningDetails: undefined, toolCalls: [R1.toolCalls[0]] }, { text: 'FINE-DIAG' }],
  capOnly: [{ ...R1, reasoningDetails: undefined, toolCalls: [R1.toolCalls[1]] }, { text: 'FINE-DIAG' }],
  reasoningTimer: [{ reasoningDetails: R1.reasoningDetails, toolCalls: [{ id: 'c1', name: 'TIMER', arguments: '{"secondi":600,"etichetta":"pasta"}' }], delayMs: 1200 }, { text: 'FINE-DIAG' }],
};
for (const [name, script] of Object.entries(VARIANTS)) test('bisezione ' + name, async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, script);
  await page.locator('#input').fill('fai quello che ti chiedo');
  await page.locator('#sendBtn').click();
  await page.waitForTimeout(5000);
  const idx = await app.evaluate(() => globalThis.__verIdx);
  const d = await dumpChat(page);
  console.log('BISEZ', name, JSON.stringify({ idx, bubbles: d.bubbles, heads: d.activities.map((a) => a.head), rows: d.activities.map((a) => a.rows), err: await app.evaluate(() => globalThis.__verErr) }));
});
