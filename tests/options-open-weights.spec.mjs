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
  // La dettatura ha bisogno di ASCOLTARE: nessun sostituto a pesi aperti lo fa,
  // quindi va annunciata fra quelle che si fermano — non fra quelle che
  // "cambiano modello", che sarebbe una bugia scoperta al primo tentativo.
  await expect(impact).toContainText(/Dettatura/i);

  // Spegnendolo l'avviso sparisce: non resta un allarme per uno stato che non c'è.
  await page.uncheck('#openWeightsOnly');
  await expect(impact).toBeHidden();
});

test('Opzioni: acceso, i «Prova» dei modelli proprietari non sono premibili', async ({ openTab }) => {
  // Il criterio è "nessuna chiamata a un fornitore escluso": questi pulsanti
  // mandano una richiesta VERA, e stanno sulla stessa pagina dell'interruttore.
  // Senza il fix restano premibili e la richiesta parte.
  const page = await openTab(OPTIONS_URL);
  await page.waitForSelector('#openWeightsOnly', { timeout: 8_000 });

  // ── Modelli predefiniti (crediti di Filo): la configurazione che gira davvero.
  await page.waitForSelector('#defaultModelsList .sn-default-model-row .sn-model-test', { timeout: 8_000 });
  const daFermare = page.locator('#defaultModelsList .sn-default-model-row')
    .filter({ hasText: /anthropic|gemini|text-embedding/i })
    .locator('.sn-model-test');
  expect(await daFermare.count()).toBeGreaterThan(0);
  for (let i = 0; i < await daFermare.count(); i++) {
    await expect(daFermare.nth(i)).toBeEnabled();
  }

  await page.check('#openWeightsOnly');
  for (let i = 0; i < await daFermare.count(); i++) {
    await expect(daFermare.nth(i)).toBeDisabled();
  }
  // Non è un blocco a tappeto: i modelli ammessi restano provabili.
  const ammessi = page.locator('#defaultModelsList .sn-default-model-row')
    .filter({ hasText: /gemma|deepseek/i })
    .locator('.sn-model-test');
  if (await ammessi.count()) await expect(ammessi.first()).toBeEnabled();

  // ── Chiavi: lo smistatore prova un modello ammesso, quindi resta vivo.
  await expect(page.locator('#testOpenrouter')).toBeEnabled();

  // ── Registry personale: stessa regola per le righe scritte dall'utente.
  await page.uncheck('#useDefaultModels');
  await expect(page.locator('#sec-models')).toBeVisible();
  const riga = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').first();
  await riga.locator('.sn-model-provider').selectOption('openrouter');
  await riga.locator('.sn-model-id').fill('anthropic/claude-3.5-haiku');
  await riga.locator('.sn-model-id').blur();
  await expect(riga.locator('.sn-model-test')).toBeDisabled();
  await riga.locator('.sn-model-id').fill('google/gemma-4-31b-it');
  await riga.locator('.sn-model-id').blur();
  await expect(riga.locator('.sn-model-test')).toBeEnabled();

  // Spento, tutto torna premibile: la differenza la fa l'interruttore.
  await page.uncheck('#openWeightsOnly');
  await expect(riga.locator('.sn-model-test')).toBeEnabled();
});

test('Opzioni: acceso, la pagina non interroga più i server di chi produce i modelli', async ({ app, openTab }) => {
  // L'ultima cosa che questa pagina mandava a un fornitore escluso non era un
  // pulsante: era il caricamento del catalogo modelli, che parte DA SOLO
  // all'apertura se una chiave del produttore è salvata. Il criterio dichiarato
  // ("nessuna chiamata a un fornitore escluso") non distingue fra una richiesta
  // partita da un click e una partita da sola.
  const chiaveSalvata = (openWeightsOnly) => app.evaluate(async (_, on) => {
    await globalThis.SN_STORAGE.setSettings({
      apiKeys: { openrouter: 'sk-or-finta-per-il-test' },
      openWeightsOnly: on,
    });
  }, openWeightsOnly);

  await chiaveSalvata(false);
  const page = await openTab(OPTIONS_URL);
  await page.waitForSelector('#openWeightsOnly', { timeout: 8_000 });

  const versoIlProduttore = [];
  page.on('request', (r) => {
    if (r.url().includes('generativelanguage.googleapis.com')) versoIlProduttore.push(r.url());
  });

  // Pre-condizione: a interruttore SPENTO la richiesta parte davvero. Senza
  // questa metà, il test passerebbe anche se il catalogo non partisse mai.
  await page.reload();
  await page.waitForSelector('#openWeightsOnly', { timeout: 8_000 });
  await expect.poll(() => versoIlProduttore.length, { timeout: 8_000 }).toBeGreaterThan(0);

  // Acceso: la stessa pagina, con la stessa chiave, non ci parla più.
  await chiaveSalvata(true);
  versoIlProduttore.length = 0;
  await page.reload();
  await page.waitForSelector('#openWeightsOnly', { timeout: 8_000 });
  await expect(page.locator('#openWeightsOnly')).toBeChecked();
  await page.waitForTimeout(1_500);
  expect(versoIlProduttore, `partita comunque una richiesta: ${versoIlProduttore[0]}`).toEqual([]);
});
