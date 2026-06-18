// AUDIT (temporaneo): riproduce il bug del parser di "/set timer".
// "5:" e ":30" hanno parti vuote attorno ai due punti: Number("") === 0, quindi
// il parser le accetta silenziosamente invece di rifiutarle.
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

test('BUG: "/set timer 5:" (secondi vuoti) crea comunque un timer', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });

  await submit(page, '/set timer 5:');
  const card = page.locator('#live .dash-live-card');
  // Se il bug esiste, compare un timer (5:00). Atteso corretto: count 0 + usage.
  await expect(card).toHaveCount(1, { timeout: 8_000 });
  await expect(card.locator('.dash-live-text')).toContainText('Timer');
  console.log('TIMER TEXT 5: ->', await card.locator('.dash-live-text').textContent());
  await page.screenshot({ path: 'tests/.shots/audit-timer-empty-seconds.png' });
});

test('BUG: "/set timer :30" (minuti vuoti) crea comunque un timer', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });

  await submit(page, '/set timer :30');
  const card = page.locator('#live .dash-live-card');
  await expect(card).toHaveCount(1, { timeout: 8_000 });
  console.log('TIMER TEXT :30 ->', await card.locator('.dash-live-text').textContent());
});
