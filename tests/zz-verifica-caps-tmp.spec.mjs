// TEMPORANEO (verifica locale): il campo «Giri migliorabile prima di promuovere»
// deve accettare 0 anche DOPO che la pagina ha finito di caricarsi.
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

test('Automazioni: il tetto dei migliorabile accetta 0', async ({ openTab }) => {
  const page = await openTab(URL);
  await expect(page.locator('#mgImprovableCap')).toHaveCount(1, { timeout: 10_000 });

  // Attende che l'inizializzazione abbia riscritto i limiti dei due campi.
  await page.waitForFunction(() => {
    const el = document.getElementById('mgImprovableCap');
    return el && el.max === '10';
  }, null, { timeout: 10_000 });

  const state = await page.evaluate(() => {
    const imp = document.getElementById('mgImprovableCap');
    const fail = document.getElementById('mgFailCap');
    imp.value = '0';
    return {
      impMin: imp.getAttribute('min'),
      impMax: imp.getAttribute('major') || imp.getAttribute('max'),
      failMin: fail.getAttribute('min'),
      validWithZero: imp.checkValidity(),
      failValidWithZero: (() => { const old = fail.value; fail.value = '0'; const v = fail.checkValidity(); fail.value = old; return v; })(),
    };
  });
  console.log('STATE', JSON.stringify(state));

  expect(state.impMin).toBe('0');
  expect(state.failMin).toBe('1');
  expect(state.validWithZero).toBe(true);
  // Simmetria: il campo delle bocciature NON deve accettare 0.
  expect(state.failValidWithZero).toBe(false);

  // Valore mostrato di default (nessun admin, nessuna cache) = 0.
  const shown = await page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 1500));
    return document.getElementById('mgImprovableCap').value;
  });
  console.log('SHOWN', shown);
  expect(shown).toBe('0');
});
