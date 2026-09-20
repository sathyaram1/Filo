// Verifica #663, giro 1 — l'accoglienza che non partiva, e le altre porte che
// portano allo stesso stato.
//
// La lamentela: al primo avvio Filo non si presenta e la home resta quella di
// chi non ha modo di pagare i modelli, perché la configurazione condivisa
// dichiara un fornitore ritirato mentre la chiave che Filo possiede è di un
// altro. Qui si prova dal di fuori, senza guardare com'è stato corretto:
//
//  1. col fornitore dichiarato ritirato l'accoglienza parte, e la home che
//     segue l'accoglienza è quella costruita dal modello (la seconda metà
//     della lamentela: «la home non è su misura»);
//  2. le tre strade che la home stessa propone per attivare Filo — riscattare
//     l'invito, incollare una chiave OpenRouter propria, scegliere un modello
//     nelle Opzioni — devono portare tutte allo stesso posto sulla home già
//     aperta, non solo la prima.

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/newtab.html';

// La configurazione condivisa com'era sul campo: il campo che dichiara il
// fornitore nomina uno ritirato, ogni modello del registro sta su OpenRouter.
async function configCondivisa(app, patch) {
  await app.evaluate(async (_electron, cfg) => {
    const Defaults = globalThis.__filoDefaults;
    const orig = globalThis.__filoDefaultsOrigGet || Defaults.get;
    globalThis.__filoDefaultsOrigGet = orig;
    Defaults.get = () => ({ ...orig(), ...cfg });
  }, patch);
}

// Il modello risponde sempre, e la sua risposta è riconoscibile: se sulla home
// compare questa frase, la home l'ha costruita il modello.
const FRASE_DEL_MODELLO = 'Ecco la tua home su misura.';

async function stubProviders(app) {
  await app.evaluate((_e, frase) => {
    const P = globalThis.SN_PROVIDERS;
    const risposta = (attempts) => ({
      text: JSON.stringify({ message: frase, suggestions: [] }),
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    P.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const r = risposta(attempts);
      try { onDelta && onDelta(r.text); } catch (_) {}
      return r;
    };
    P.completeWithFallback = async ({ attempts }) => risposta(attempts);
  }, FRASE_DEL_MODELLO);
}

async function conChiave(app, chiave = 'sk-or-vera') {
  await app.evaluate(async (_e, k) => {
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: k } });
  }, chiave);
}

async function newtab(app) {
  const scadenza = Date.now() + 10_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => x.url().startsWith('filo://newtab'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('fornitore dichiarato ritirato: Filo si presenta, e la home dopo l’accoglienza è quella del modello', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await configCondivisa(app, { provider: 'gemini' });
  await conChiave(app);
  await stubProviders(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  // Prima metà della lamentela: l'intervista esiste.
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 20_000 });
  await expect(page.locator('.dash-bubble-filo').first())
    .toContainText('Ciao, sono Filo', { timeout: 10_000 });

  // Seconda metà: chiusa l'accoglienza, la home NON è il cartello di chi non
  // ha crediti — è quella costruita dal modello.
  await page.locator('.dash-skip-onboarding').click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 30_000 });
  const messaggio = page.locator('#homeMessage');
  await expect(messaggio).not.toContainText(/codice d.invito/i, { timeout: 20_000 });
  await expect(messaggio).toContainText(FRASE_DEL_MODELLO, { timeout: 20_000 });
});

test('la chiave OpenRouter propria, incollata mentre la home è aperta: l’accoglienza parte', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await configCondivisa(app, { provider: 'gemini' });
  await stubProviders(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  // Punto di partenza: nessuna chiave. La home lo dice e propone due strade —
  // l'invito, oppure «lì puoi mettere una tua chiave OpenRouter».
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 15_000 });
  await expect(page.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 15_000 });

  // La seconda strada, presa esattamente come la prende la pagina Crediti:
  // salva la chiave nelle impostazioni. Da qui in poi Filo può rispondere.
  await page.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.UPDATE_SETTINGS,
      settings: { apiKeys: { openrouter: 'sk-or-mia' } },
    });
  });

  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 20_000 });
  await expect(page.locator('.dash-bubble-filo').first())
    .toContainText('Ciao, sono Filo', { timeout: 10_000 });
});

test('il modello scelto nelle Opzioni mentre la home è aperta: l’accoglienza parte', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  // Crediti a posto, nessun modello configurato: è il caso in cui la home
  // manda l'utente nelle Opzioni a sceglierne uno.
  await configCondivisa(app, { provider: 'openrouter', models: {} });
  await conChiave(app);
  await stubProviders(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 15_000 });
  await expect(page.locator('#homeMessage')).toContainText(/nessun modello/i, { timeout: 15_000 });

  // La strada che la home propone: scegliere un modello. Lo salviamo come lo
  // salverebbe la pagina Opzioni, con la configurazione propria.
  const azioni = await page.evaluate(() => {
    const A = window.SN_CONST.ACTIONS;
    return { chat: A.FILO_CHAT, home: A.FILO_DASHBOARD };
  });
  await page.evaluate(async (a) => {
    await chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.UPDATE_SETTINGS,
      settings: {
        useDefaultModels: false,
        models: { [a.chat]: 'testo', [a.home]: 'testo' },
        modelRegistry: { testo: { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash-0731' } },
      },
    });
  }, azioni);

  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 20_000 });
  await expect(page.locator('.dash-bubble-filo').first())
    .toContainText('Ciao, sono Filo', { timeout: 10_000 });
});

test('«solo modelli a pesi aperti» senza sostituti: la home dice perché Filo tace', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  const azioni = await page.evaluate(() => {
    const A = window.SN_CONST.ACTIONS;
    return { chat: A.FILO_CHAT, home: A.FILO_DASHBOARD };
  });
  // Crediti a posto, modelli configurati ed esistenti: l'unica cosa che spegne
  // Filo è l'interruttore «solo modelli a pesi aperti», acceso su una
  // configurazione fatta di soli modelli proprietari.
  await configCondivisa(app, {
    provider: 'openrouter',
    models: { [azioni.chat]: 'chiuso', [azioni.home]: 'chiuso' },
    modelRegistry: { chiuso: { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' } },
  });
  await conChiave(app);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ openWeightsOnly: true });
  });
  await stubProviders(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 15_000 });
  const messaggio = page.locator('#homeMessage');
  // Quello che l'utente deve poter capire: è l'interruttore che ha acceso, non
  // una configurazione dei modelli vuota o che cita modelli inesistenti.
  await expect(messaggio).not.toContainText(/codice d.invito/i, { timeout: 15_000 });
  await expect(messaggio).toContainText(/pesi aperti/i, { timeout: 15_000 });
});
