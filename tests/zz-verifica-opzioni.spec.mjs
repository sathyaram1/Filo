// VERIFICA INDIPENDENTE — da cancellare a fine verifica.
import { test, expect } from './fixtures/electron.mjs';

test('Opzioni: nessun Google/Gemini fra fornitori e chiavi', async ({ openTab }) => {
  const page = await openTab('filo://options/options.html');
  await page.waitForLoadState('load');
  await page.waitForTimeout(3000);

  const dump = await page.evaluate(() => {
    const selects = [...document.querySelectorAll('select')].map((s) => ({
      id: s.id, cls: s.className,
      options: [...s.options].map((o) => o.value + '|' + o.textContent.trim()),
    })).filter((s) => s.options.length < 40);
    // combo box "finti" (SN_COMBO) — voci di menu
    const combos = [...document.querySelectorAll('.sn-select-option')]
      .map((o) => (o.dataset.value || '') + '|' + o.textContent.trim());
    const keys = [...document.querySelectorAll('input[type=password]')]
      .map((el) => el.id + '|' + el.placeholder);
    return { selects, combos: [...new Set(combos)], keys, text: document.body.innerText };
  });
  console.log('=== CHIAVI ===\n' + dump.keys.join('\n'));
  console.log('=== SELECT (piccoli) ===\n' + JSON.stringify(dump.selects, null, 1));
  console.log('=== COMBO OPTIONS ===\n' + dump.combos.join('\n'));
  console.log('=== TESTO ===\n' + dump.text.slice(0, 6000));
});
