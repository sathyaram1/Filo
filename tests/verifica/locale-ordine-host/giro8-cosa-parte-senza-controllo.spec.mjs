// L'altra faccia della stessa famiglia: adesso che quello che si vede sullo
// schermo parte da ogni uscita, parte anche quello che la pagina avrebbe
// rifiutato. Il registro dei modelli si difende; la catena per azione no.

import { test, expect } from '../../fixtures/electron.mjs';

const OPZIONI = 'filo://options/options.html';

async function chiudiScheda(shell, frammento) {
  const id = await shell.evaluate(async (f) => {
    const s = await window.filoShell.tabs.snapshot();
    const lista = Array.isArray(s) ? s : (s && s.tabs) || [];
    const t = lista.find((x) => (x.url || '').includes(f));
    return t ? t.id : null;
  }, frammento);
  expect(id, `la scheda ${frammento} non compare fra quelle aperte`).toBeTruthy();
  await shell.evaluate((i) => window.filoShell.tabs.close(i), id);
}

const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());

// I modelli per azione si vedono solo con i modelli propri.
async function apriModelliPropri(openTab) {
  const page = await openTab(OPZIONI);
  await page.waitForSelector('#useDefaultModels', { timeout: 20_000 });
  if (await page.locator('#useDefaultModels').isChecked()) {
    await page.click('#useDefaultModels');
  }
  await page.waitForSelector('.sn-chain-input', { timeout: 20_000 });
  return page;
}

test('Opzioni: un modello per azione che non esiste non entra nella configurazione chiudendo la scheda', async ({ app, shell, openTab }) => {
  const page = await apriModelliPropri(openTab);
  const primo = page.locator('.sn-chain-input').first();
  const prima = await primo.inputValue();

  await primo.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('soprannome-che-non-esiste');

  await chiudiScheda(shell, 'options');
  await new Promise((r) => setTimeout(r, 1500));

  const salvati = await impostazioni(app).then((s) => JSON.stringify(s.models || {}));
  expect(salvati,
    'chiudendo la scheda col cursore nel campo, la catena per azione si prende un soprannome che non esiste e nessuno lo dice')
    .not.toContain('soprannome-che-non-esiste');
  expect(typeof prima).toBe('string');
});

// Controllo: confermando col cursore fuori dal campo, la pagina rifiuta e
// rimette il valore di prima. È la metà che funziona.
test('Opzioni: uscendo dal campo, il soprannome che non esiste viene rifiutato', async ({ shell, openTab }) => {
  const page = await apriModelliPropri(openTab);
  const primo = page.locator('.sn-chain-input').first();
  const prima = await primo.inputValue();

  await primo.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('soprannome-che-non-esiste');
  await page.keyboard.press('Tab');

  await expect.poll(() => primo.inputValue(), { timeout: 5000 }).toBe(prima);

  await chiudiScheda(shell, 'options');
});
