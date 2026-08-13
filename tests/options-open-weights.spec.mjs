// #461 — l'interruttore "Solo modelli a pesi aperti" nella pagina Opzioni.
//
// Il comportamento vero (cosa parte verso la rete) è in open-weights-only.spec;
// qui si verifica che l'interruttore esista dove si cercano le impostazioni dei
// modelli, che la scelta resti, e — soprattutto — che dica COSA CAMBIA prima di
// accenderlo: senza quell'elenco chi lo accende scopre solo usando l'app che
// alcune funzioni si sono fermate.
//
// Pre-condizione che senza il fix fallirebbe: l'interruttore non esisteva, e
// accendere "solo pesi aperti" non era possibile da nessuna parte.

import { test, expect } from './fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';

test('Opzioni: l\'interruttore dei pesi aperti è spento di default e la scelta resta', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await page.waitForSelector('#openWeightsOnly', { timeout: 8_000 });

  // Sta accanto alle altre impostazioni sui modelli, non sepolto altrove.
  await expect(page.locator('#openWeightsOnly')).toBeVisible();
  await expect(page.locator('#openWeightsOnly')).not.toBeChecked();

  await page.check('#openWeightsOnly');
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

  await page.reload();
  await page.waitForSelector('#openWeightsOnly', { timeout: 8_000 });
  await expect(page.locator('#openWeightsOnly')).toBeChecked();
});

test('Opzioni: acceso, dichiara quali funzioni cambiano modello e quali si fermano', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await page.waitForSelector('#openWeightsOnly', { timeout: 8_000 });

  // Configurazione personale nota: una funzione con equivalente aperto e una
  // (la sintesi vocale) che un equivalente non ce l'ha.
  await page.uncheck('#useDefaultModels');
  await expect(page.locator('#sec-models')).toBeVisible();

  await expect(page.locator('#openWeightsImpact')).toBeHidden();
  await page.check('#openWeightsOnly');

  const impact = page.locator('#openWeightsImpact');
  await expect(impact).toBeVisible();
  // Chi cambia modello: il nome del modello aperto che prenderà il posto.
  await expect(impact).toContainText('gemma');
  // Chi si ferma: la funzione è nominata, non lasciata scoprire all'uso.
  await expect(impact).toContainText(/Lettura ad alta voce/i);

  // Spegnendolo l'avviso sparisce: non resta un allarme per uno stato che non c'è.
  await page.uncheck('#openWeightsOnly');
  await expect(impact).toBeHidden();
});

// I pulsanti «Prova» della lista dei modelli predefiniti mandano richieste vere,
// pagate con le chiavi di Filo. Con l'interruttore acceso quelli che finirebbero
// su un modello proprietario devono essere spenti — e solo quelli: spegnerli
// tutti nasconderebbe che i modelli ammessi si possono ancora provare.
//
// Pre-condizione che senza il fix fallirebbe: erano tutti premibili, e premerli
// mandava la richiesta.
test('Opzioni: acceso, la «Prova» dei modelli esclusi è spenta (e quella degli ammessi no)', async ({ openTab }) => {
  const page = await openTab(OPTIONS_URL);
  await page.waitForSelector('#openWeightsOnly', { timeout: 8_000 });

  // Lista read-only dei modelli predefiniti (è la configurazione con i crediti
  // di Filo, quella in cui l'utente si trova per primo).
  await expect(page.locator('#useDefaultModels')).toBeChecked();
  const rows = page.locator('#defaultModelsList .sn-default-model-row:not(.sn-model-row-head)');
  await expect(rows.first()).toBeVisible({ timeout: 8_000 });

  // Le righe sono la configurazione VERA (costanti + config condivisa, che
  // cambia nel tempo): il test legge cosa c'è e verifica la regola su ogni riga,
  // invece di fotografare i nomi dei modelli di oggi.
  const leggiRighe = () => page.evaluate(() => {
    const C = window.SN_CONST;
    const out = [];
    const rows = document.querySelectorAll('#defaultModelsList .sn-default-model-row:not(.sn-model-row-head)');
    for (const row of rows) {
      const celle = row.querySelectorAll('.sn-default-model-cell');
      const provider = (celle[1]?.textContent || '').includes('Gemini') ? 'gemini' : 'openrouter';
      const model = celle[2]?.textContent || '';
      out.push({
        nick: celle[0]?.textContent || '',
        ammesso: C.isOpenWeightsEntry({ provider, model }) === true,
        spento: row.querySelector('button')?.disabled === true,
        stato: row.querySelector('.sn-model-row-status')?.textContent || '',
      });
    }
    return out;
  });

  // Spento: si possono provare tutte.
  const prima = await leggiRighe();
  expect(prima.length).toBeGreaterThan(1);
  expect(prima.filter((r) => r.spento)).toEqual([]);

  await page.check('#openWeightsOnly');

  const dopo = await leggiRighe();
  const esclusi = dopo.filter((r) => !r.ammesso);
  const ammessi = dopo.filter((r) => r.ammesso);
  expect(esclusi.length, 'fra i predefiniti deve esserci almeno un modello escluso').toBeGreaterThan(0);
  expect(ammessi.length, 'fra i predefiniti deve esserci almeno un modello ammesso').toBeGreaterThan(0);
  // Le righe escluse non si provano più, e dicono perché.
  for (const r of esclusi) {
    expect(r.spento, `«${r.nick}» è escluso ma la sua «Prova» è ancora premibile`).toBe(true);
    expect(r.stato).toMatch(/pesi aperti/i);
  }
  // I modelli ammessi restano provabili: l'interruttore non spegne tutto.
  for (const r of ammessi) {
    expect(r.spento, `«${r.nick}» è ammesso ma la sua «Prova» è spenta`).toBe(false);
  }

  // Anche la prova della chiave del produttore diretto resta spenta.
  await page.uncheck('#useDefaultModels');
  await expect(page.locator('#testGemini')).toBeDisabled();
  await expect(page.locator('#testOpenrouter')).toBeEnabled();
});
