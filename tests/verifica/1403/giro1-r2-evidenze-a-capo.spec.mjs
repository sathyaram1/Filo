// Verifica #1403 giro 1: con la barra di scorrimento della casella, l'evidenza deve restare sotto la parte segnata.
import { test, expect } from '../../fixtures/electron.mjs';

const SHOTS = 'tests/.shots';

async function newtab(app) {
  await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://newtab')), { timeout: 10_000 }).toBe(true);
  const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

const PASSWORD = 'Gatto!2024';

test('r2 testo che scorre: la riga che va a capo nella casella va a capo anche sotto, e l\'evidenza resta sulla password', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await app.evaluate(async () => {
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models: { ...T.models }, modelRegistry: T.registry,
    });
    globalThis.__invii = [];
    globalThis.SN_FEEDBACK.submit = async (p) => { globalThis.__invii.push(p); return { id: 'fb-1', seq: 1, failed: [] }; };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ trovati: [{ tipo: 'segreto', pezzo: 'Gatto!2024' }] }),
      provider: attempts[0].provider, model: attempts[0].model, servedBy: 'DeepInfra', usage: {},
    });
  });
  const righe = Array.from({ length: 30 }, (_, i) => `Passo ${i + 1} del racconto.`);
  const dopo = Array.from({ length: 12 }, (_, i) => `Nota ${i + 1} in fondo.`);
  const TESTO = `Il login non va.\n${righe.join('\n')}\nQuinta riga.\nLa password è Gatto!2024 e non entra.\n${dopo.join('\n')}`;
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-text').fill(TESTO);
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-l0')).toBeVisible({ timeout: 12_000 });
  await expect(page.locator('.sn-fb-evidenze mark')).toHaveText([PASSWORD]);

  // Una riga scritta in mezzo, lunga quanto basta per andare a capo nella casella (che ha la barra) e non sotto.
  const esito = await page.evaluate((pw) => {
    const ta = document.querySelector('.sn-fb-text');
    const ev = document.querySelector('.sn-fb-evidenze');
    const base = ta.value;
    const at = base.indexOf('Quinta riga.');
    for (let k = 1; k < 400; k++) {
      const riga = 'Il codice di errore era ' + 'x'.repeat(k);
      ta.value = base.slice(0, at) + riga + '\n' + base.slice(at);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      if (ta.scrollHeight !== ev.scrollHeight) {
        // La riga della password a metà della casella, come dopo «Correggi».
        const prima = ta.value.slice(0, ta.value.indexOf(pw)).split('\n').length + 1;
        ta.scrollTop = Math.max(0, prima * parseFloat(getComputedStyle(ta).lineHeight) - ta.clientHeight / 2);
        ta.dispatchEvent(new Event('scroll'));
        return { k, casella: ta.scrollHeight, sotto: ev.scrollHeight, barra: ta.offsetWidth - ta.clientWidth };
      }
    }
    return { k: 0, casella: ta.scrollHeight, sotto: ev.scrollHeight, barra: ta.offsetWidth - ta.clientWidth };
  }, PASSWORD);
  await page.waitForTimeout(200);
  await page.locator('.sn-fb-modal').screenshot({ path: `${SHOTS}/v1403-r2-evidenza.png` });
  expect(esito.sotto, `con ${esito.k} parole la casella va a capo e lo strato delle evidenze no (barra di ${esito.barra} px)`).toBe(esito.casella);
});
