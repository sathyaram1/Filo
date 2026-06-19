// TEMP audit-explore: stress the dashboard chat command surface with edge
// inputs to look for crashes / absurd rendering. Not a kept test.
import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

async function submit(page, command) {
  await page.evaluate((cmd) => {
    const input = document.getElementById('input');
    const form = document.getElementById('inputForm');
    input.value = cmd;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, command);
}

test('huge timer value rendering', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });

  await submit(page, '/set timer 100000');
  const card = page.locator('#live .dash-live-card');
  await expect(card).toHaveCount(1, { timeout: 8_000 });
  const txt = await card.locator('.dash-live-text').textContent();
  console.log('HUGE TIMER TEXT:', JSON.stringify(txt));
  await page.screenshot({ path: 'tests/.shots/audit-huge-timer.png' });
});

test('edge command inputs do not crash dashboard', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });

  const inputs = [
    '/set timer 0',
    '/set timer -5',
    '/set timer 5:60',
    '/set timer 1:2:3',
    '/clear all extra args here',
    '/gift abc def',
    '/   ',
    '/' + 'a'.repeat(500),
  ];
  for (const cmd of inputs) {
    await submit(page, cmd);
    await page.waitForTimeout(120);
  }
  // dashboard still responsive: input still present & page not crashed
  await expect(input).toBeVisible();
  const bubbles = await page.locator('.dash-bubble').count();
  console.log('BUBBLE COUNT after edge inputs:', bubbles);
  const liveCards = await page.locator('#live .dash-live-card').count();
  console.log('LIVE CARDS after edge inputs (expect 0 timers created):', liveCards);
  await page.screenshot({ path: 'tests/.shots/audit-edge-inputs.png' });
});
