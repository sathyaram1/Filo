// Le impostazioni (filo://options/): modelli predefiniti, catene, registro, solo pesi aperti, categorie, pagina viva.
// Una sola app per il file, riportata com'era appena aperta prima di ogni prova (tests/helpers/appCondivisa.mjs).

import { appCondivisa } from './helpers/appCondivisa.mjs';
import { CONFIRM_HOST, clickConfirm } from './helpers/confirm.mjs';

const { test, expect } = appCondivisa();

test.describe('options-altro-category-delete-confirm', () => {
  // Feedback #276: in Opzioni → Altro, il bottone "Elimina" di una categoria
  // apriva la finestrella di conferma NATIVA del browser ("La pagina dice: …")
  // invece del popup stilizzato di Filo (SN_CONFIRM_UI), stesso schema del bug
  // già noto per "Svuota archivio" e "Cancella tutto" della Cronologia AI.
  //
  // ASSERISCE il successo: dopo aver seminato una categoria e cliccato "Elimina"
  // compare l'host del dialogo stilizzato (.sn-confirm-host) e NON viene generato
  // alcun dialogo nativo del browser. Pre-fix la pagina non caricava confirmUi.js
  // e chiamava confirm() nativo → rosso (host mai visibile, dialog nativo).

  const ALTRO_URL = 'filo://options/altro.html';

  test('Opzioni → Altro: "Elimina" categoria usa il popup stilizzato, non il confirm nativo', async ({ openTab }) => {
    const page = await openTab(ALTRO_URL);
    await page.waitForLoadState('domcontentloaded');

    // Semina una categoria così che compaia una riga con il bottone "Elimina",
    // poi ricarica per far ri-renderizzare la lista.
    await page.evaluate(async () => {
      await chrome.storage.local.set({ categories: [{ id: 'test-cat-276', name: 'CategoriaTest276' }] });
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Il modulo delle conferme deve essere caricato dalla pagina.
    expect(await page.evaluate(() => typeof window.SN_CONFIRM_UI)).toBe('object');

    // La riga della categoria seminata è presente.
    const row = page.locator('.sn-cat-row');
    await expect(row).toHaveCount(1);

    // Se ricomparisse il confirm nativo Playwright lo intercetterebbe qui.
    let nativeDialog = false;
    page.on('dialog', async (d) => { nativeDialog = true; await d.dismiss().catch(() => {}); });

    // Il bottone "Elimina" è l'ultimo della riga.
    await row.locator('button.sn-btn-secondary').last().click();

    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
    expect(nativeDialog, 'nessun confirm nativo del browser deve comparire').toBe(false);

    // Confermando dal popup stilizzato la categoria viene davvero eliminata:
    // la feature funziona end-to-end, non si limita a mostrare il dialogo giusto.
    await clickConfirm(page, 'ok');
    await expect(page.locator('.sn-cat-row')).toHaveCount(0, { timeout: 5_000 });
    const remaining = await page.evaluate(async () => {
      const r = await chrome.storage.local.get('categories');
      return (r.categories || []).length;
    });
    expect(remaining, 'la categoria è rimossa dallo storage dopo la conferma').toBe(0);
  });
});

test.describe('options-default-models', () => {
  // Switch "Usa modelli predefiniti" nella pagina Opzioni.
  //
  // Requisito: di base l'utente usa modelli/chiavi predefiniti senza configurare
  // nulla, quindi lo switch è ON e la config avanzata (provider/chiavi, registry,
  // modelli per azione) è NASCOSTA. Disattivando lo switch la config compare e la
  // scelta si persiste.
  //
  // Pre-condizione che senza il fix fallirebbe: prima non esisteva lo switch e le
  // sezioni erano sempre visibili; ora di default sono nascoste (#sec-provider
  // non è visibile) e ricompaiono solo a switch OFF.

  const OPTIONS_URL = 'filo://options/options.html';

  test('Opzioni: lo switch è ON di default e nasconde provider/registry/modelli', async ({ openTab }) => {
    const page = await openTab(OPTIONS_URL);
    await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });

    await expect(page.locator('#useDefaultModels')).toBeChecked();
    await expect(page.locator('#sec-provider')).toBeHidden();
    await expect(page.locator('#sec-model-registry')).toBeHidden();
    await expect(page.locator('#sec-models')).toBeHidden();
  });

  test('Opzioni: disattivare lo switch rivela la config e la scelta si persiste', async ({ openTab }) => {
    const page = await openTab(OPTIONS_URL);
    await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });

    await page.uncheck('#useDefaultModels');

    // Le sezioni avanzate diventano visibili immediatamente.
    await expect(page.locator('#sec-provider')).toBeVisible();
    await expect(page.locator('#sec-model-registry')).toBeVisible();
    await expect(page.locator('#sec-models')).toBeVisible();

    // L'auto-save lampeggia la conferma.
    await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

    // Ricaricando, lo switch è ancora OFF e la config resta visibile.
    await page.reload();
    await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
    await expect(page.locator('#useDefaultModels')).not.toBeChecked();
    await expect(page.locator('#sec-provider')).toBeVisible();
  });

  // La misura del pulsante «Prova» è di chi l'ha fatta: la lista dei modelli
  // predefiniti è in sola lettura, e senza un posto dove tenerla spariva a ogni
  // ricaricamento proprio dove sta quasi tutta la gente (switch acceso).
  test('Opzioni: la misura del «Prova» di un modello predefinito resta dopo il ricaricamento', async ({ app, openTab }) => {
    await app.evaluate(async () => {
      const vero = global.fetch;
      global.fetch = async (url, init) => {
        const u = String(url && url.url ? url.url : url);
        if (!u.includes('openrouter.ai/')) return vero(url, init);
        if (u.includes('/chat/completions')) {
          const sse = 'data: {"choices":[{"delta":{"content":"1, 2, 3"}}]}\n\n'
            + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":9}}\n\n'
            + 'data: [DONE]\n\n';
          return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      };
      await globalThis.SN_STORAGE.updateSettings({
        useDefaultModels: true,
        openWeightsOnly: false,
        apiKeys: { openrouter: 'sk-or-finta' },
      });
    });

    const riga = (page) => page.locator('#defaultModelsList .sn-default-model-row:not(.sn-model-row-head)').first();
    const page = await openTab(OPTIONS_URL);
    await riga(page).waitFor({ timeout: 15_000 });
    await riga(page).locator('.sn-model-test').click();
    await expect(riga(page).locator('.sn-model-row-status')).toHaveText(/TTFT\s+\d/, { timeout: 20_000 });

    await page.reload();
    await riga(page).waitFor({ timeout: 15_000 });
    await expect(riga(page).locator('.sn-model-row-status'), 'la misura è sparita col ricaricamento')
      .toHaveText(/TTFT\s+\d/, { timeout: 10_000 });
  });

  // Una riga dei modelli propri con ordinamento e ragionamento suoi: la misura è presa con quelli, e con quelli deve
  // ancora valere dopo il ricaricamento.
  test('Opzioni: la misura del «Prova» di un modello proprio con ordinamento e ragionamento resta dopo il ricaricamento', async ({ app, openTab }) => {
    await app.evaluate(async () => {
      const vero = global.fetch;
      global.fetch = async (url, init) => {
        const u = String(url && url.url ? url.url : url);
        if (!u.includes('openrouter.ai/')) return vero(url, init);
        if (u.includes('/chat/completions')) {
          const sse = 'data: {"choices":[{"delta":{"content":"1, 2, 3"}}]}\n\n'
            + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":9}}\n\n'
            + 'data: [DONE]\n\n';
          return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      };
      await globalThis.SN_STORAGE.updateSettings({
        useDefaultModels: false,
        openWeightsOnly: false,
        apiKeys: { openrouter: 'sk-or-finta' },
        modelRegistry: { mio: { provider: 'openrouter', model: 'finto/mio', sort: 'throughput', reasoning: 'high' } },
      });
    });

    const riga = async (page) => {
      const sel = '#modelRegistryList .sn-model-row:not(.sn-model-row-head)';
      await page.waitForSelector(sel, { timeout: 15_000 });
      const i = await page.evaluate((q) => Array.from(document.querySelectorAll(q))
        .findIndex((r) => (r.querySelector('.sn-model-nick') || {}).value === 'mio'), sel);
      expect(i, 'la riga «mio» non c\'è').toBeGreaterThanOrEqual(0);
      return page.locator(sel).nth(i);
    };
    const page = await openTab(OPTIONS_URL);
    await (await riga(page)).locator('.sn-model-test').click();
    await expect((await riga(page)).locator('.sn-model-row-status')).toHaveText(/TTFT\s+\d/, { timeout: 20_000 });

    await page.reload();
    await expect((await riga(page)).locator('.sn-model-row-status'), 'la misura è sparita col ricaricamento')
      .toHaveText(/TTFT\s+\d/, { timeout: 10_000 });
  });

  test('Opzioni: riattivare lo switch ri-nasconde la config', async ({ openTab }) => {
    const page = await openTab(OPTIONS_URL);
    await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });

    await page.uncheck('#useDefaultModels');
    await expect(page.locator('#sec-provider')).toBeVisible();

    await page.check('#useDefaultModels');
    await expect(page.locator('#sec-provider')).toBeHidden();
    await expect(page.locator('#sec-models')).toBeHidden();
  });

  // Una riga su «Automatico» segue la scelta generale degli host: cambiata
  // quella, i numeri di prima parlano di un altro modo di scegliere l'host, e
  // restare sullo schermo come se valessero ancora è peggio che sparire.
  test('Opzioni: cambiata la scelta generale degli host, la misura di prima non resta', async ({ app, openTab }) => {
    const generaleA = (valore) => app.evaluate(async (_e, v) => {
      const D = globalThis.__filoDefaults;
      if (!globalThis.__getVeroGenerale) globalThis.__getVeroGenerale = D.get;
      D.get = (...a) => ({ ...globalThis.__getVeroGenerale(...a), providerSort: v });
    }, valore);

    await app.evaluate(async () => {
      const vero = global.fetch;
      global.fetch = async (url, init) => {
        const u = String(url && url.url ? url.url : url);
        if (!u.includes('openrouter.ai/')) return vero(url, init);
        if (u.includes('/chat/completions')) {
          const sse = 'data: {"choices":[{"delta":{"content":"1, 2, 3"}}]}\n\n'
            + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":9}}\n\n'
            + 'data: [DONE]\n\n';
          return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      };
      await globalThis.SN_STORAGE.updateSettings({
        useDefaultModels: true,
        openWeightsOnly: false,
        apiKeys: { openrouter: 'sk-or-finta' },
      });
    });
    await generaleA('price');

    const riga = (page) => page.locator('#defaultModelsList .sn-default-model-row:not(.sn-model-row-head)').first();
    const page = await openTab(OPTIONS_URL);
    await riga(page).waitFor({ timeout: 15_000 });
    await riga(page).locator('.sn-model-test').click();
    await expect(riga(page).locator('.sn-model-row-status')).toHaveText(/TTFT\s+\d/, { timeout: 20_000 });

    await generaleA('throughput');
    await page.reload();
    await riga(page).waitFor({ timeout: 15_000 });
    await expect(riga(page).locator('.sn-model-row-status'),
      'la misura parla di un ordinamento che non è più quello in vigore')
      .toHaveText(/Non ancora testato/, { timeout: 10_000 });
  });
});

test.describe('options-home-models', () => {
  // I modelli della Home sono configurabili: "Home — generazione della dashboard"
  // (azione filo_dashboard) e "Home — chat con Filo" (azione filo_chat) devono
  // comparire nell'editor "Modelli per azione" delle Opzioni ed essere salvabili.
  //
  // Bug coperto: l'editor esponeva un sottoinsieme fisso di azioni che NON
  // includeva le due azioni della Home → quei modelli restavano inchiodati ai
  // default senza alcun modo di cambiarli. Senza il fix il primo assert (celle
  // presenti) è rosso.

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
});

test.describe('options-model-chain-dropdown', () => {
  // Feedback alpha (BiA4JTqkNasdsRQ0A7eQ): il menu di selezione del modello nelle
  // pagine "Modelli" (Opzioni) e "Modelli predefiniti" usava il popup NATIVO della
  // <datalist>, fuori dalla palette di Filo (colori di sistema). Ora l'editor a
  // segmenti mostra un dropdown custom coerente con gli altri menu a tendina di
  // Filo (classi .sn-select-*), letto dalle stesse opzioni del registry.
  //
  // Il test asserisce il COMPORTAMENTO atteso (non solo l'assenza del vecchio):
  //   1. L'input del segmento NON usa più la datalist nativa (niente attributo
  //      `list`) → senza il fix questo è rosso.
  //   2. Mettendo a fuoco l'input compare un popup custom .sn-chain-pop con le
  //      opzioni del registry (es. "flash"); è lo stile coerente di Filo.
  //   3. Cliccando un'opzione l'input si compila con quel nickname e il valore
  //      viene salvato → la selezione "dalla tendina" funziona davvero.

  const OPTIONS_URL = 'filo://options/options.html';

  async function revealAdvanced(page) {
    await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
    await page.uncheck('#useDefaultModels');
    await page.waitForSelector('#modelsGrid .sn-chain', { timeout: 4_000 });
  }

  test('Modelli per azione: dropdown custom Filo al posto della datalist nativa', async ({ openTab }) => {
    const page = await openTab(OPTIONS_URL);
    await revealAdvanced(page);

    const chain = page.locator('#modelsGrid .sn-chain').nth(1); // EXPLAIN_DEEP (1 segmento)
    const input = chain.locator('.sn-chain-input').nth(0);

    // (1) Niente più popup nativo della datalist.
    await expect(input).not.toHaveAttribute('list', /.*/);

    // (2) Il focus apre il dropdown custom con le opzioni del registry.
    await input.focus();
    const pop = chain.locator('.sn-chain-pop');
    await expect(pop).toBeVisible({ timeout: 4_000 });
    const flashOpt = pop.locator('.sn-select-option', { hasText: 'deepseek-flash' }).first();
    await expect(flashOpt).toBeVisible();

    // (3) Cliccando un'opzione l'input si compila e il valore persiste.
    await input.fill('deepseek-flash');
    await expect(pop).toBeVisible();
    const exact = pop.locator('.sn-select-option').filter({ has: page.locator('.sn-chain-opt-nick', { hasText: /^deepseek-flash$/ }) }).first();
    await exact.click();
    await expect(input).toHaveValue('deepseek-flash');

    await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
    const saved = await page.evaluate(async () => {
      const s = await window.SN_STORAGE.getSettings();
      return s.models[window.SN_CONST.ACTIONS.EXPLAIN_DEEP];
    });
    expect(saved).toBe('deepseek-flash');
  });

  test('Modelli per azione: digitando si filtra la tendina custom', async ({ openTab }) => {
    const page = await openTab(OPTIONS_URL);
    await revealAdvanced(page);

    const chain = page.locator('#modelsGrid .sn-chain').nth(1);
    const input = chain.locator('.sn-chain-input').nth(0);
    await input.focus();
    const pop = chain.locator('.sn-chain-pop');
    await expect(pop).toBeVisible({ timeout: 4_000 });

    // Al focus si vedono TUTTI i nickname del registry (anche con il campo già
    // compilato col default), così l'utente può sceglierne un altro.
    const total = await pop.locator('.sn-select-option').count();
    expect(total).toBeGreaterThan(1);

    // Filtra per "whisper": resta solo whisper.
    await input.fill('whisper');
    await expect(pop.locator('.sn-select-option')).toHaveCount(1);
    await expect(pop.locator('.sn-select-option').first()).toContainText('whisper');
  });
});

test.describe('options-model-chain', () => {
  // Feature: editor "a segmenti" della catena di fallback per azione, più la
  // nuova pagina "Altro" (dove sono migrate blocklist e categorie).
  //
  // I test asseriscono il COMPORTAMENTO:
  //   1. Si possono inserire più modelli per un'azione (primario + fallback) con
  //      i pulsanti "+/×", e la catena viene salvata e ripristinata al reload
  //      come lista ordinata (settings.models[action] = "alpha, beta").
  //   2. La pagina "Altro" esiste e ospita la sezione "Domini esclusi"
  //      (blocklist), che NON è più in Opzioni.
  //
  // Nota: usiamo la 2ª azione (EXPLAIN_DEEP) perché il suo default è un singolo
  // nickname ('claude-haiku') → la catena parte da 1 segmento, comodo per testare
  // l'aggiunta. (La 1ª, EXPLAIN, parte già con 2 segmenti "flash, flash-or".)

  const OPTIONS_URL = 'filo://options/options.html';

  async function revealAdvanced(page) {
    await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
    await page.uncheck('#useDefaultModels');
    await page.waitForSelector('#modelsGrid .sn-chain', { timeout: 4_000 });
  }

  test('Modelli per azione: aggiungere un fallback crea una catena ordinata che persiste', async ({ openTab }) => {
    const page = await openTab(OPTIONS_URL);
    await revealAdvanced(page);

    const chain = page.locator('#modelsGrid .sn-chain').nth(1); // EXPLAIN_DEEP
    const inputs = chain.locator('.sn-chain-input');
    await expect(inputs).toHaveCount(1);
    await inputs.nth(0).fill('alpha');
    // Aggiungi un secondo segmento (fallback) e compilalo.
    await chain.locator('.sn-chain-add').click();
    await expect(inputs).toHaveCount(2);
    await inputs.nth(1).fill('beta');
    await inputs.nth(1).blur();

    await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

    // EXPLAIN_DEEP ora ha la catena "alpha, beta" nei settings.
    const saved = await page.evaluate(async () => {
      const s = await window.SN_STORAGE.getSettings();
      return s.models[window.SN_CONST.ACTIONS.EXPLAIN_DEEP];
    });
    expect(saved).toBe('alpha, beta');

    // Reload: i due segmenti riappaiono in ordine.
    await page.reload();
    await page.waitForSelector('#modelsGrid .sn-chain', { timeout: 8_000 });
    const reInputs = page.locator('#modelsGrid .sn-chain').nth(1).locator('.sn-chain-input');
    await expect(reInputs).toHaveCount(2);
    await expect(reInputs.nth(0)).toHaveValue('alpha');
    await expect(reInputs.nth(1)).toHaveValue('beta');
  });

  test('Modelli per azione: rimuovere un segmento riduce la catena', async ({ openTab }) => {
    const page = await openTab(OPTIONS_URL);
    await revealAdvanced(page);

    const chain = page.locator('#modelsGrid .sn-chain').nth(1); // EXPLAIN_DEEP
    const inputs = chain.locator('.sn-chain-input');
    await expect(inputs).toHaveCount(1);
    await inputs.nth(0).fill('uno');
    await chain.locator('.sn-chain-add').click();
    await expect(inputs).toHaveCount(2);
    await inputs.nth(1).fill('due');

    // Rimuovi il secondo segmento → ne resta uno solo, col valore del primo.
    await chain.locator('.sn-chain-rm').nth(1).click();
    await expect(inputs).toHaveCount(1);
    await expect(inputs.nth(0)).toHaveValue('uno');
  });

  test('Opzioni: link "Altro" presente e blocklist NON più in pagina', async ({ openTab }) => {
    const opts = await openTab(OPTIONS_URL);
    await expect(opts.locator('#openOther')).toHaveAttribute('href', 'altro.html');
    await expect(opts.locator('#blocklist')).toHaveCount(0);
  });

  test('Pagina "Altro": contiene domini esclusi, categorie e il link di ritorno', async ({ openTab }) => {
    const altro = await openTab('filo://options/altro.html');
    await expect(altro.locator('#blocklist')).toBeAttached({ timeout: 8_000 });
    await expect(altro.locator('#h-categories')).toBeAttached();
    await expect(altro.locator('#backToModels')).toHaveAttribute('href', 'options.html');
  });
});

test.describe('options-model-combobox', () => {
  // Richiesta: "il box dove si scrive il codice del modello dovrebbe essere un
  // menu a tendina con tutti i modelli di quel provider, con possibilità di
  // scrivere per cercare".
  //
  // Implementazione: il campo "stringa modello" di ogni riga del registry è un
  // combobox (input + <datalist>) legato al PROVIDER della riga; la lista è
  // seminata con i modelli già nel registry e poi completata via API.
  //
  // Questi test asseriscono il COMPORTAMENTO, senza dipendere dalla rete:
  //   1. Il campo è legato alla datalist del provider (niente popup nativo).
  //   2. Un modello salvato compare nella tendina alla riapertura.
  //   3. Una lista che arriva dopo il fuoco apre la tendina rimasta vuota.

  const OPTIONS_URL = 'filo://options/options.html';

  // NB: `.sn-model-row` è usata sia dal registry editor (#modelRegistryList) sia
  // dalla lista read-only dei modelli predefiniti (#defaultModelsList): scopare
  // SEMPRE le query a #modelRegistryList per non prendere le righe sbagliate.
  const ROW = '#modelRegistryList .sn-model-row:not(.sn-model-row-head)';

  // Il catalogo del fornitore arriva dalla rete quando arriva e SOSTITUISCE la lista della tendina: una voce messa
  // a mano prima spariva sulla macchina che la rete ce l'ha (#687). Lo serve la prova; `trattieni` aspetta
  // `__rilasciaCatalogo()`.
  async function serviCatalogo(app, ids, { trattieni = false } = {}) {
    await app.context().addInitScript(({ ids, trattieni }) => {
      let apri = () => {};
      const via = trattieni ? new Promise((r) => { apri = r; }) : Promise.resolve();
      window.__rilasciaCatalogo = () => apri();
      const orig = window.fetch;
      window.fetch = function (url) {
        if (!/^https:\/\/openrouter\.ai\/api\/v1\/models/.test(String(url))) return orig.apply(this, arguments);
        return via.then(() => new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }),
          { status: 200, headers: { 'content-type': 'application/json' } }));
      };
    }, { ids, trattieni });
  }

  const lista = (page) => page.evaluate(() =>
    [...document.getElementById('models-list-openrouter').options].map((o) => o.value));

  async function revealAdvanced(page) {
    await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
    await page.uncheck('#useDefaultModels');
    await page.waitForSelector('#sec-model-registry:not([hidden])', { timeout: 4_000 });
    await page.waitForSelector(ROW, { timeout: 8_000 });
  }

  test('Modelli: il campo è un combobox custom legato al provider della riga', async ({ app, openTab }) => {
    await serviCatalogo(app, ['vendor/modello-di-prova']);
    const page = await openTab(OPTIONS_URL);
    await revealAdvanced(page);

    // La datalist del provider esiste (sorgente dati del combobox); la vecchia
    // "models-list" condivisa no, e non c'è più quella di un'API diretta di Google.
    expect(await page.locator('#models-list-openrouter').count()).toBe(1);
    expect(await page.locator('#models-list').count()).toBe(0);
    expect(await page.locator('#models-list-gemini').count()).toBe(0);

    const row = page.locator(ROW).first();
    const idInput = row.locator('.sn-model-id');

    // Niente più popup NATIVO della datalist: il campo non ha l'attributo `list`
    // (senza il fix questo è rosso). Il dropdown ora è quello custom .sn-select-*.
    await expect(idInput).not.toHaveAttribute('list', /.*/);

    // Il catalogo del fornitore entra nella lista del combobox.
    await expect.poll(() => lista(page), { timeout: 6_000 }).toContain('vendor/modello-di-prova');

    // Aprendo il campo, il dropdown custom mostra il modello del catalogo. Col clic, il gesto dell'utente: un `focus()`
    // dato da fuori non genera l'evento in una finestra che il fuoco non ce l'ha.
    await row.locator('.sn-model-provider').selectOption('openrouter');
    await idInput.click();
    // Scope al wrapper del campo: anche il <select> del provider è un menu custom
    // di Filo con il suo .sn-select-pop, quindi nella riga ce n'è più d'uno.
    const pop = row.locator('.sn-model-id-wrap .sn-select-pop');
    await expect(pop).toBeVisible({ timeout: 4_000 });
    await expect(pop.locator('.sn-select-option', { hasText: 'vendor/modello-di-prova' })).toBeVisible();
  });

  test('Modelli: se la lista arriva dopo il fuoco, la tendina rimasta vuota si apre da sé', async ({ app, openTab }) => {
    // Registro vuoto (il caso di chi spegne i modelli predefiniti): finché il catalogo non arriva non c'è niente da
    // proporre, e la tendina restava chiusa sotto il campo a fuoco finché non si cliccava di nuovo.
    await app.evaluate(async () => {
      await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, modelRegistry: {} });
    });
    await serviCatalogo(app, ['vendor/arrivato-dopo'], { trattieni: true });
    const page = await openTab(OPTIONS_URL);
    await page.waitForSelector(ROW, { timeout: 8_000 });

    const row = page.locator(ROW).first();
    const idInput = row.locator('.sn-model-id');
    const pop = row.locator('.sn-model-id-wrap .sn-select-pop');
    await idInput.click();
    expect(await lista(page)).toEqual([]);
    await expect(pop).toBeHidden();

    await page.evaluate(() => window.__rilasciaCatalogo());
    await expect(pop).toBeVisible({ timeout: 6_000 });
    await expect(pop.locator('.sn-select-option', { hasText: 'vendor/arrivato-dopo' })).toBeVisible();
    // `toBeFocused` chiede anche che la finestra abbia il fuoco, e quella parcheggiata della suite spesso non ce l'ha.
    expect(await idInput.evaluate((el) => el.ownerDocument.activeElement === el)).toBe(true);
  });

  test('Modelli: un modello salvato compare nella tendina alla riapertura', async ({ openTab }) => {
    const page = await openTab(OPTIONS_URL);
    await revealAdvanced(page);

    // Compila la prima riga con un modello e salva.
    await page.evaluate(() => {
      const row = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
      row.querySelector('.sn-model-nick').value = 'miomodello';
      row.querySelector('.sn-model-provider').value = 'openrouter';
      row.querySelector('.sn-model-id').value = 'vendor/modello-salvato';
      row.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
    // Il salvataggio è differito: si aspetta che il registro salvato contenga la riga.
    await expect.poll(() => page.evaluate(async () => {
      const s = await window.SN_STORAGE.getSettings();
      return (s.modelRegistry && s.modelRegistry.miomodello && s.modelRegistry.miomodello.model) || '';
    }), { timeout: 5_000 }).toBe('vendor/modello-salvato');

    // Ricarica: il seeding della tendina parte dal registry salvato.
    await page.reload();
    await revealAdvanced(page);

    await page.waitForFunction(() => {
      const dl = document.getElementById('models-list-openrouter');
      return !!dl && [...dl.options].some((o) => o.value === 'vendor/modello-salvato');
    }, null, { timeout: 6_000 });
  });
});

test.describe('options-model-registry-invalid-row', () => {
  // Feedback #216: nelle Opzioni, aggiungere un modello personalizzato senza
  // nickname (o con un nickname duplicato) faceva sparire la riga SENZA nessun
  // avviso — anzi l'app mostrava "Salvato", quindi l'utente credeva che fosse
  // tutto a posto. Riprodotto: Opzioni → disattiva "usa modelli predefiniti" →
  // compila provider+stringa modello ma lascia il nickname vuoto → sposta il
  // cursore → appare "Salvato" → dopo reload la riga non c'è più.
  //
  // Questi test asseriscono il COMPORTAMENTO corretto, non solo l'assenza
  // dell'errore precedente:
  //   1. Una riga con nickname vuoto ma provider/stringa compilati NON produce
  //      una conferma "Salvato" indistinguibile da un salvataggio riuscito: la
  //      riga viene evidenziata e la conferma segnala che qualcosa è stato
  //      scartato. Senza il fix l'hint aveva solo la classe `sn-show` (nessun
  //      indicatore d'allerta) e la riga non aveva alcun segno.
  //   2. Una seconda riga con lo stesso nickname di una già presente viene
  //      scartata con lo stesso avviso (non silenziosamente, non con un
  //      duplicato invisibile nel registry).
  //   3. Una riga valida (nickname compilato, non duplicato) continua a
  //      salvare normalmente: la conferma resta "Salvato" senza avviso e la
  //      riga non viene marcata come non valida.
  //   4. La conferma parla dell'ULTIMA modifica: appena ne arriva un'altra
  //      sparisce, e torna solo quando anche quella è nello storage. Senza il
  //      fix restava in vista mentre una modifica era ancora in attesa, e chi
  //      chiudeva la pagina in quel momento la perdeva credendola salvata.

  const OPTIONS_URL = 'filo://options/options.html';

  async function revealRegistry(page) {
    await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
    await page.uncheck('#useDefaultModels');
    await page.waitForSelector('#sec-model-registry:not([hidden])', { timeout: 4_000 });
  }

  test('riga senza nickname: evidenziata e NON confermata come salvataggio pulito', async ({ openTab }) => {
    const page = await openTab(OPTIONS_URL);
    await revealRegistry(page);

    await page.evaluate(() => {
      const row = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
      row.querySelector('.sn-model-nick').value = ''; // nickname lasciato vuoto
      row.querySelector('.sn-model-provider').value = 'openrouter';
      row.querySelector('.sn-model-id').value = 'openai/gpt-4o-mini';
      row.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // La conferma NON deve sembrare un salvataggio pulito: deve portare
    // l'indicatore d'allerta (il fix), non solo `sn-show`.
    await expect(page.locator('#savedHint')).toHaveClass(/sn-hint-warn/, { timeout: 4_000 });

    const rowState = await page.evaluate(() => {
      const row = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
      return {
        rowInvalid: row.classList.contains('sn-row-invalid'),
        nickInvalid: row.querySelector('.sn-model-nick').classList.contains('sn-input-invalid'),
        msg: row.querySelector('.sn-model-row-msg')?.textContent || '',
      };
    });
    expect(rowState.rowInvalid).toBe(true);
    expect(rowState.nickInvalid).toBe(true);
    expect(rowState.msg.length).toBeGreaterThan(0);

    // La riga non compare nel registry salvato: dopo reload non c'è traccia
    // dell'id inserito (comportamento invariato — quello che cambia è che ora
    // l'utente lo sa).
    await page.reload();
    await revealRegistry(page);
    const ids = await page.evaluate(() => [...document.querySelectorAll('#modelRegistryList .sn-model-id')].map((i) => i.value));
    expect(ids).not.toContain('openai/gpt-4o-mini');
  });

  test('nickname duplicato: la seconda riga viene scartata con lo stesso avviso', async ({ openTab }) => {
    const page = await openTab(OPTIONS_URL);
    await revealRegistry(page);

    await page.evaluate(() => {
      const list = document.getElementById('modelRegistryList');
      const first = list.querySelector('.sn-model-row:not(.sn-model-row-head)');
      first.querySelector('.sn-model-nick').value = 'dup';
      first.querySelector('.sn-model-provider').value = 'openrouter';
      first.querySelector('.sn-model-id').value = 'openai/gpt-4o-mini';

      document.getElementById('addModelRow').click();
      const rows = [...list.querySelectorAll('.sn-model-row:not(.sn-model-row-head)')];
      const second = rows[rows.length - 1];
      second.querySelector('.sn-model-nick').value = 'dup';
      second.querySelector('.sn-model-provider').value = 'gemini';
      second.querySelector('.sn-model-id').value = 'gemini-2.0-flash';
      second.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect(page.locator('#savedHint')).toHaveClass(/sn-hint-warn/, { timeout: 4_000 });

    const secondRowInvalid = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#modelRegistryList .sn-model-row:not(.sn-model-row-head)')];
      const second = rows.find((r) => r.querySelector('.sn-model-id')?.value === 'gemini-2.0-flash');
      return second ? second.classList.contains('sn-row-invalid') : null;
    });
    expect(secondRowInvalid).toBe(true);

    // Il registry salvato tiene solo la prima definizione del nickname duplicato.
    await page.reload();
    await revealRegistry(page);
    const dupModel = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#modelRegistryList .sn-model-row:not(.sn-model-row-head)')];
      const row = rows.find((r) => r.querySelector('.sn-model-nick')?.value === 'dup');
      return row ? row.querySelector('.sn-model-id').value : null;
    });
    expect(dupModel).toBe('openai/gpt-4o-mini');
  });

  test('riga valida: la conferma resta "Salvato" senza avviso e senza segni sulla riga', async ({ openTab }) => {
    const page = await openTab(OPTIONS_URL);
    await revealRegistry(page);

    await page.evaluate(() => {
      const row = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
      row.querySelector('.sn-model-nick').value = 'valida';
      row.querySelector('.sn-model-provider').value = 'openrouter';
      row.querySelector('.sn-model-id').value = 'openai/gpt-4o-mini';
      row.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
    await expect(page.locator('#savedHint')).not.toHaveClass(/sn-hint-warn/);

    const rowInvalid = await page.evaluate(() => {
      const row = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
      return row.classList.contains('sn-row-invalid');
    });
    expect(rowInvalid).toBe(false);
  });

  test('la conferma parla dell\'ultima modifica, non di quella di prima', async ({ openTab }) => {
    const page = await openTab(OPTIONS_URL);
    await revealRegistry(page);

    await page.evaluate(() => {
      const row = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
      row.querySelector('.sn-model-nick').value = 'prima';
      row.querySelector('.sn-model-provider').value = 'openrouter';
      row.querySelector('.sn-model-id').value = 'openai/gpt-4o-mini';
      row.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

    // Seconda modifica mentre la conferma di prima è ancora sullo schermo: da
    // quell'istante c'è qualcosa che salvato non è, e la conferma deve sparire.
    const confermaRimasta = await page.evaluate(() => {
      const hint = document.getElementById('savedHint');
      const row = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
      row.querySelector('.sn-model-id').value = 'openai/gpt-4o';
      row.dispatchEvent(new Event('change', { bubbles: true }));
      return hint.classList.contains('sn-show');
    });
    expect(confermaRimasta).toBe(false);

    // Quando torna, quello che l'utente vede scritto è davvero quello salvato.
    await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
    const salvato = await page.evaluate(async () => {
      const s = await window.SN_STORAGE.getSettings();
      return (s.modelRegistry && s.modelRegistry.prima && s.modelRegistry.prima.model) || '';
    });
    expect(salvato).toBe('openai/gpt-4o');
  });
});

test.describe('options-multi-model', () => {
  // Feedback: "per ogni attività deve essere possibile impostare più modelli (il
  // primo è quello usato, gli altri sono fallback in ordine)" + "ogni modello ha
  // un tasto prova che salva latenza e token al secondo".
  //
  // Questi test asseriscono il COMPORTAMENTO della feature:
  //   1. La catena di fallback per un'azione con più nickname è costruita
  //      nell'ordine giusto (tutti i provider del modello primario, poi quelli
  //      del secondo, ecc.). Senza il fix `buildModelAttempts` non esisteva e la
  //      risoluzione gestiva un solo modello.
  //   2. Un risultato di test (latenza + token/sec) salvato su un modello del
  //      registry persiste tra i reload della pagina opzioni. Senza il fix il
  //      risultato era effimero (solo durante il test) e spariva al reload.

  const OPTIONS_URL = 'filo://options/options.html';

  test('Modelli: la catena di fallback per azione ordina primario poi secondari', async ({ openTab }) => {
    const page = await openTab(OPTIONS_URL);
    await page.waitForFunction(() => !!window.SN_CONST?.buildModelAttempts, null, { timeout: 8_000 });

    const chain = await page.evaluate(() => {
      const C = window.SN_CONST;
      const refs = C.parseModelRefs('deepseek-flash, gemma-lite, claude');
      const order = ['openrouter'];
      const keys = { openrouter: 'or' };
      return C.buildModelAttempts(refs, globalThis.SN_TEST_MODELS.registry, order, keys);
    });

    // Ogni nickname ha UN solo provider; la catena segue l'ordine scritto:
    // primario, poi i ripieghi.
    expect(chain.map((a) => `${a.provider}:${a.model}`)).toEqual([
      'openrouter:deepseek/deepseek-v4-flash',
      'openrouter:google/gemma-4-26b-a4b-it',
      'openrouter:anthropic/claude-haiku-4.5',
    ]);
  });

  test('Modelli: un singolo nickname risolve solo sul suo provider', async ({ openTab }) => {
    const page = await openTab(OPTIONS_URL);
    await page.waitForFunction(() => !!window.SN_CONST?.buildModelAttempts, null, { timeout: 8_000 });

    const chain = await page.evaluate(() => {
      const C = window.SN_CONST;
      const refs = C.parseModelRefs('deepseek-flash');
      // Un secondo fornitore (immaginario) con la sua chiave: il nickname non
      // deve produrre un tentativo anche lì.
      return C.buildModelAttempts(refs, globalThis.SN_TEST_MODELS.registry, ['openrouter', 'altro'], { openrouter: 'or', altro: 'x' });
    });
    expect(chain.map((a) => `${a.provider}:${a.model}`)).toEqual([
      'openrouter:deepseek/deepseek-v4-flash',
    ]);
  });

  test('Modelli: il risultato del test (latenza/token-sec) persiste tra i reload', async ({ openTab }) => {
    const page = await openTab(OPTIONS_URL);
    await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });

    // Rivela la config avanzata (registry + modelli per azione).
    await page.uncheck('#useDefaultModels');
    await page.waitForSelector('#sec-model-registry:not([hidden])', { timeout: 4_000 });

    // Compila la prima riga del registry e simula un risultato di test salvato
    // (in cloud non c'è la API key per il vero "Prova", ma la persistenza non
    // dipende dalla rete: passa per lo stesso salvataggio del registry).
    await page.evaluate(() => {
      // Scopa a #modelRegistryList: `.sn-model-row` è usata anche dalla lista
      // read-only dei modelli predefiniti (#defaultModelsList), che apparendo
      // prima nel DOM verrebbe presa per errore (e non ha .sn-model-nick).
      const row = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
      row.querySelector('.sn-model-nick').value = 'provatm';
      row.querySelector('.sn-model-provider').value = 'openrouter';
      row.querySelector('.sn-model-id').value = 'anthropic/claude-3.5-haiku';
      // La misura porta con sé il modello su cui è stata presa: senza, vale per
      // un'altra riga e non va mostrata.
      row._test = { ttftMs: 321, tokensPerSec: 48.5, at: new Date().toISOString(),
        model: 'anthropic/claude-3.5-haiku' };
      // Forza il render immediato + il salvataggio (change bubbla fino a #page).
      row.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });

    // Ricarica: il risultato salvato deve riapparire nel div di stato della riga.
    await page.reload();
    await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
    await page.waitForSelector('#sec-model-registry:not([hidden])', { timeout: 4_000 });

    const statusText = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#modelRegistryList .sn-model-row:not(.sn-model-row-head)')];
      const row = rows.find((r) => r.querySelector('.sn-model-nick')?.value === 'provatm');
      return row ? row.querySelector('.sn-model-row-status')?.textContent || '' : '';
    });
    expect(statusText).toContain('321');
    expect(statusText).toContain('48.5');
  });
});

test.describe('options-open-weights', () => {
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

    // Configurazione personale nota: le funzioni predefinite partono quasi tutte
    // da pesi aperti; quelle su Anthropic hanno un equivalente aperto.
    await page.uncheck('#useDefaultModels');
    await expect(page.locator('#sec-models')).toBeVisible();

    await expect(page.locator('#openWeightsImpact')).toBeHidden();
    await page.check('#openWeightsOnly');

    const impact = page.locator('#openWeightsImpact');
    await expect(impact).toBeVisible();
    // Chi cambia modello: il nome del modello aperto che prenderà il posto.
    await expect(impact).toContainText('deepseek');
    // Nessuna funzione si ferma: lettura ad alta voce, dettatura e indicizzazione
    // partono già da modelli a pesi aperti, quindi non vanno annunciate come
    // ferme (sarebbe un allarme per uno stato che non c'è).
    await expect(impact).not.toContainText(/Si fermano/i);
    await expect(impact).not.toContainText(/Dettatura/i);

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

  test('Opzioni: la pagina non interroga i server di chi produce i modelli, acceso o spento', async ({ app, openTab }) => {
    // L'ultima cosa che questa pagina mandava a un fornitore escluso non era un
    // pulsante: era il caricamento del catalogo modelli, che parte DA SOLO
    // all'apertura. Oggi l'API diretta di Google non è più in Filo: il catalogo
    // arriva dal router (pubblico, ammesso), e verso i produttori esclusi non
    // parte niente, con l'interruttore spento come acceso.
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
    const versoIlRouter = [];
    const PRODUTTORI = /generativelanguage\.googleapis\.com|api\.openai\.com|api\.mistral\.ai|api\.x\.ai|dashscope/i;
    page.on('request', (r) => {
      if (PRODUTTORI.test(r.url())) versoIlProduttore.push(r.url());
      if (r.url().includes('openrouter.ai/api/v1/models')) versoIlRouter.push(r.url());
    });

    // Pre-condizione: a interruttore SPENTO il catalogo parte davvero, dal
    // router. Senza questa metà il test passerebbe anche a pagina muta.
    await page.reload();
    await page.waitForSelector('#openWeightsOnly', { timeout: 8_000 });
    await expect.poll(() => versoIlRouter.length, { timeout: 8_000 }).toBeGreaterThan(0);
    expect(versoIlProduttore, `partita una richiesta verso un produttore: ${versoIlProduttore[0]}`).toEqual([]);

    // Acceso: idem, niente verso i produttori.
    await chiaveSalvata(true);
    versoIlProduttore.length = 0;
    await page.reload();
    await page.waitForSelector('#openWeightsOnly', { timeout: 8_000 });
    await expect(page.locator('#openWeightsOnly')).toBeChecked();
    await page.waitForTimeout(1_500);
    expect(versoIlProduttore, `partita comunque una richiesta: ${versoIlProduttore[0]}`).toEqual([]);
  });
});

test.describe('options-pagina-viva', () => {
  // La pagina Opzioni aperta segue i cambiamenti fatti da fuori (#667).
  // Il modello di un'azione si sceglie anche dal tasto destro di una pagina web
  // (la dettatura): se la pagina Opzioni restasse ferma alla fotografia
  // dell'apertura, il primo campo toccato lì rimanderebbe indietro quella scelta.

  const daFuori = (page, models) => page.evaluate(
    (m) => chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.UPDATE_SETTINGS,
      settings: { models: m },
    }),
    models,
  );

  const salvate = (page) => page.evaluate(async () => {
    const r = await chrome.storage.local.get('settings');
    return (r && r.settings) || {};
  });

  test('il modello scelto altrove resta scelto dopo un campo toccato in Opzioni', async ({ openTab }) => {
    const altrove = await openTab('filo://newtab/');
    const opts = await openTab('filo://options/options.html');
    await opts.waitForSelector('#monthlyLimit');

    await daFuori(altrove, { transcribe_audio: 'dettatore-scelto' });
    await expect
      .poll(async () => (await salvate(opts)).models?.transcribe_audio, { timeout: 8_000 })
      .toBe('dettatore-scelto');

    // Un campo che coi modelli non c'entra: il limite di spesa.
    await opts.fill('#monthlyLimit', '7');
    await opts.locator('#monthlyLimit').blur();
    await expect.poll(async () => (await salvate(opts)).monthlyLimitEur, { timeout: 8_000 }).toBe(7);

    const dopo = await salvate(opts);
    expect(dopo.models.transcribe_audio, 'il modello scelto altrove resta').toBe('dettatore-scelto');
  });

  // Si cerca l'etichetta della cella, non il testo: la tendina aperta di un'altra funzione elenca modelli con le stesse parole.
  const cella = (page, etichetta) => page.locator('#modelsGrid > div')
    .filter({ has: page.locator(':scope > label', { hasText: etichetta }) });

  // #667.7: il cambio da fuori riscrive la catena che è cambiata, non tutta la griglia; ridisegnarla intera portava
  // via la spiegazione del modello appena respinto in un'altra funzione.
  test('un modello cambiato da fuori non cancella la spiegazione di un rifiuto in un\'altra funzione', async ({ openTab }) => {
    const altrove = await openTab('filo://newtab/');
    const opts = await openTab('filo://options/options.html');
    await opts.waitForSelector('#useDefaultModels');
    await opts.uncheck('#useDefaultModels');
    await expect.poll(async () => (await salvate(opts)).useDefaultModels, { timeout: 8_000 }).toBe(false);

    const spiega = cella(opts, 'Spiega (inline)').locator('.sn-chain-seg').first();
    await spiega.locator('.sn-chain-input').fill('kokoro');
    await opts.keyboard.press('Tab');
    await expect(spiega.locator('.sn-chain-msg')).toBeVisible({ timeout: 4_000 });

    await daFuori(altrove, { transcribe_audio: 'dettatore-scelto' });
    await expect(cella(opts, 'Dettatura').locator('.sn-chain-input').first()).toHaveValue('dettatore-scelto', { timeout: 8_000 });
    await expect(spiega.locator('.sn-chain-msg')).toHaveText(/Modello non adatto: \S/);
  });

  // Chi sta scrivendo in una funzione non ferma il cambio arrivato da fuori per un'altra: col primo salvataggio
  // la griglia ferma l'avrebbe rimandato indietro.
  test('mentre si scrive in una funzione, il modello cambiato da fuori per un\'altra arriva e resta', async ({ openTab }) => {
    const altrove = await openTab('filo://newtab/');
    const opts = await openTab('filo://options/options.html');
    await opts.waitForSelector('#useDefaultModels');
    await opts.uncheck('#useDefaultModels');
    await expect.poll(async () => (await salvate(opts)).useDefaultModels, { timeout: 8_000 }).toBe(false);

    const spiega = cella(opts, 'Spiega (inline)').locator('.sn-chain-input').first();
    await spiega.click();
    await opts.keyboard.press('End');
    await spiega.pressSequentially('abc');

    await daFuori(altrove, { transcribe_audio: 'dettatore-scelto' });
    await expect(cella(opts, 'Dettatura').locator('.sn-chain-input').first()).toHaveValue('dettatore-scelto', { timeout: 8_000 });
    await expect(spiega, 'la casella in uso non si tocca').toBeFocused();
    await expect(spiega).toHaveValue(/abc$/);

    await opts.keyboard.press('Tab');
    await expect.poll(async () => (await salvate(opts)).models?.explain || '', { timeout: 8_000 }).toContain('abc');
    expect((await salvate(opts)).models.transcribe_audio, 'il modello scelto altrove resta').toBe('dettatore-scelto');
  });
});
