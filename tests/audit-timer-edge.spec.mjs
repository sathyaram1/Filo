// AUDIT (routine): esercita il comando "/set timer" della barra nuova scheda
// con input limite (numeri enormi) per vedere se il timer entra in uno stato
// rotto invece di rifiutare la durata.
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

test('huge timer value does not produce a broken (NaN) timer card', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });

  // Un utente digita un numero enorme di minuti (overflow della data).
  await submit(page, '/set timer 999999999999');

  // Aspetta che qualcosa renda: o una card timer, o una riga di errore Filo.
  await page.waitForTimeout(2500);

  const cardText = await page.locator('#live .dash-live-card').first().textContent().catch(() => '');
  const bubbleText = await page.locator('#bubbles').textContent().catch(() => '');
  console.log('CARD TEXT >>>', JSON.stringify(cardText));
  console.log('BUBBLE TEXT >>>', JSON.stringify(bubbleText));

  await page.screenshot({ path: 'tests/.shots/audit-timer-huge.png' }).catch(() => {});

  // Il display NON deve contenere "NaN" e non deve esserci una card timer
  // con countdown malformato.
  expect(cardText || '').not.toContain('NaN');
});
