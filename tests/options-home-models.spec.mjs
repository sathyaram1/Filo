// I modelli della Home sono configurabili: "Home — generazione della dashboard"
// (azione filo_dashboard) e "Home — chat con Filo" (azione filo_chat) devono
// comparire nell'editor "Modelli per azione" delle Opzioni ed essere salvabili.
//
// Bug coperto: l'editor esponeva un sottoinsieme fisso di azioni che NON
// includeva le due azioni della Home → quei modelli restavano inchiodati ai
// default senza alcun modo di cambiarli. Senza il fix il primo assert (celle
// presenti) è rosso.

import { test, expect } from './fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';

// Trova la cella del grid "Modelli per azione" con l'etichetta data e ritorna
// il primo input della sua catena.
async function chainInput(page, labelText) {
  return page.locator('#modelsGrid > div')
    .filter({ has: page.locator('label', { hasText: labelText }) })
    .first()
    .locator('.sn-chain-input')
    .first();
}

test('Opzioni: i modelli della Home (dashboard e chat) sono impostabili e persistono', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  // La casella c'è già nell'HTML: la griglia invece la disegna il caricamento, che poi rimette la casella com'era
  // salvata. Toccarla prima annullava il gesto della prova.
  await page.waitForSelector('#modelsGrid .sn-chain-input', { state: 'attached', timeout: 8_000 });

  // Rivela la config avanzata (registry + modelli per azione).
  await page.uncheck('#useDefaultModels');
  await page.waitForSelector('#sec-model-registry:not([hidden])', { timeout: 4_000 });

  // Le due celle nuove esistono nel grid.
  const dashInput = await chainInput(page, 'Home — generazione della dashboard');
  const chatInput = await chainInput(page, 'Home — chat con Filo');
  await expect(dashInput).toBeVisible();
  await expect(chatInput).toBeVisible();

  // Imposta un nickname per ciascuna e confermalo. Il `change` di ognuna si manda a mano: quello che nasce dal
  // passaggio del fuoco non arriva se la finestra della suite non ha il fuoco (in Electron Playwright non lo finge).
  await dashInput.fill('miodash');
  await dashInput.dispatchEvent('change');
  await chatInput.fill('miachat');
  await chatInput.dispatchEvent('change');

  // I valori sono persistiti sotto le chiavi azione della Home, quelle che legge modelForAction; è cambiato solo
  // il PRIMO segmento della catena predefinita, gli altri restano fallback. Si aspetta il valore e non «Salvato»,
  // che resta acceso 1,5 s anche dal salvataggio della casella e dava il via prima che i due arrivassero.
  const primari = () => page.evaluate(async () => {
    const m = (await window.SN_STORAGE.getSettings()).models || {};
    return [m.filo_dashboard, m.filo_chat].map((v) => String(v || '').split(',')[0].trim());
  });
  await expect.poll(primari, { timeout: 8_000 }).toEqual(['miodash', 'miachat']);

  // Dopo un reload l'editor rimostra i valori salvati.
  await page.reload();
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  const dashAfter = await chainInput(page, 'Home — generazione della dashboard');
  const chatAfter = await chainInput(page, 'Home — chat con Filo');
  await expect(dashAfter).toHaveValue('miodash');
  await expect(chatAfter).toHaveValue('miachat');

  // Traccia visiva della run (cartella gitignorata, non è il primary signal).
  await page.locator('#modelsGrid').scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: 'tests/.shots/options-home-models.png', fullPage: true }).catch(() => {});
});
