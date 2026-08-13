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

  const provaDi = (nick) => page.locator('#defaultModelsList .sn-default-model-row')
    .filter({ has: page.locator(`div:text-is("${nick}")`) })
    .locator('button');

  // Spento: si possono provare tutti.
  await expect(provaDi('claude-haiku')).toBeEnabled();
  await expect(provaDi('gemma')).toBeEnabled();

  await page.check('#openWeightsOnly');

  // Acceso: il modello di Anthropic e quelli serviti dal produttore non si
  // provano più, e la riga dice perché.
  await expect(provaDi('claude-haiku')).toBeDisabled();
  await expect(provaDi('tts')).toBeDisabled();
  await expect(page.locator('#defaultModelsList .sn-default-model-row')
    .filter({ has: page.locator('div:text-is("claude-haiku")') })
    .locator('.sn-model-row-status')).toContainText(/pesi aperti/i);
  // Il modello a pesi aperti resta provabile: l'interruttore non spegne tutto.
  await expect(provaDi('gemma')).toBeEnabled();

  // Anche la prova della chiave del produttore diretto resta spenta.
  await page.uncheck('#useDefaultModels');
  await expect(page.locator('#testGemini')).toBeDisabled();
  await expect(page.locator('#testOpenrouter')).toBeEnabled();
});
