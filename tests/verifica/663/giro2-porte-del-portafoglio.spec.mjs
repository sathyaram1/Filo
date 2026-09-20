// Verifica #663, giro 2 — le porte che passano dal PORTAFOGLIO.
//
// La chiave dell'invitato non sta nelle impostazioni: la tiene il portafoglio,
// e la configurazione effettiva se la prende a ogni chiamata. È la chiave di
// ogni utente nuovo, quindi è la strada principale, non un caso di bordo.
//
// Qui si provano le tre porte che ne dipendono:
//  1. l'invitato che poi accende «solo modelli a pesi aperti»: la home deve
//     dire che Filo non può più rispondere;
//  2. l'invitato che poi spegne «usa i modelli predefiniti»: idem;
//  3. l'accoglienza già fatta e nessuna chiave: la home manda a riscattare
//     l'invito; riscattato, il cartello deve sparire da solo — è la stessa
//     cosa che succede incollando una chiave propria, che funziona.

import { test, expect } from '../../fixtures/electron.mjs';

const FRASE_DEL_MODELLO = 'Ecco la tua home su misura.';
const CHIAVE_DELL_INVITO = 'sk-or-personale-dall-invito';

async function configCondivisa(app, patch) {
  await app.evaluate(async (_electron, cfg) => {
    const Defaults = globalThis.__filoDefaults;
    const orig = globalThis.__filoDefaultsOrigGet || Defaults.get;
    globalThis.__filoDefaultsOrigGet = orig;
    Defaults.get = () => ({ ...orig(), ...cfg });
  }, patch);
}

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

async function chiaveNelleImpostazioni(app, chiave) {
  await app.evaluate(async (_e, k) => {
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: k } });
  }, chiave);
}

// Il riscatto dell'invito visto da dentro: la chiave si DEPOSITA nel
// portafoglio come fa il riscatto vero, e una stringa vuota la toglie.
// Sostituire la funzione che la legge salterebbe proprio il momento in cui
// Filo diventa capace di rispondere. `require` nudo non esiste dentro
// app.evaluate (il codice ci arriva come eval): serve il createRequire.
async function chiaveNelPortafoglio(app, chiave = CHIAVE_DELL_INVITO) {
  await app.evaluate((_e, k) => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    const w = req('./auth/wallet-store');
    if (k) w.save({ key: k, pseudonym: 'prova' }); else w.clear();
  }, chiave);
}

// L'avviso che il riscatto manda alle pagine aperte: è la riga che wallet.js
// spedisce quando l'invito va a buon fine.
async function avvisoCreditiCambiati(app) {
  await app.evaluate(() => {
    globalThis.SN_BROADCAST_FILO({ type: globalThis.SN_MSG.MSG.CREDITS_CHANGED });
  });
}

async function accoglienzaGiaFatta(app) {
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    const O = globalThis.SN_ONBOARDING;
    await M.setOnboarding(O.close(O.emptyState(), new Date().toISOString()));
  });
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

async function impostazioni(page, patch) {
  await page.evaluate(async (p) => {
    await chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: p,
    });
  }, patch);
}

test('invitato, poi «solo modelli a pesi aperti»: la home dice che Filo non può più rispondere', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  const azioni = await app.evaluate(() => {
    const A = globalThis.SN_CONST.ACTIONS;
    return { chat: A.FILO_CHAT, home: A.FILO_DASHBOARD };
  });
  await configCondivisa(app, {
    provider: 'openrouter',
    models: { [azioni.chat]: 'chiuso', [azioni.home]: 'chiuso' },
    modelRegistry: { chiuso: { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' } },
  });
  await chiaveNelPortafoglio(app);
  await avvisoCreditiCambiati(app);
  await accoglienzaGiaFatta(app);
  await stubProviders(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 15_000 });
  await expect(page.locator('#homeMessage')).toContainText(FRASE_DEL_MODELLO, { timeout: 20_000 });

  await impostazioni(page, { openWeightsOnly: true });
  await expect(page.locator('#homeMessage')).toContainText(/pesi aperti/i, { timeout: 30_000 });
});

// «Voglio gestirmi i modelli da solo» non basta a spegnere Filo: la
// configurazione personale nasce già piena. Perché Filo diventi muto davvero
// bisogna anche svuotarla, ed è quello che fa questo test.
test('invitato, poi i modelli propri e nessuno scelto: la home dice che Filo non può più rispondere', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await configCondivisa(app, { provider: 'openrouter' });
  await chiaveNelPortafoglio(app);
  await avvisoCreditiCambiati(app);
  await accoglienzaGiaFatta(app);
  await stubProviders(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 15_000 });
  await expect(page.locator('#homeMessage')).toContainText(FRASE_DEL_MODELLO, { timeout: 20_000 });

  await impostazioni(page, { useDefaultModels: false });
  await expect(page.locator('#homeMessage')).toContainText(/nessun modello|Opzioni/i, { timeout: 30_000 });
});

// La home propone tre strade quando Filo non ha di che rispondere: riscattare
// l'invito, incollare una chiave propria, scegliere un modello. Le ultime due
// passano dalle impostazioni e la home se ne accorge. La prima — quella che la
// home mette in cima, e l'unica che ha chi è appena entrato — passa dal
// portafoglio.
test('accoglienza già fatta: riscattato l’invito, il cartello sparisce senza ricaricare', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await configCondivisa(app, { provider: 'openrouter' });
  await chiaveNelleImpostazioni(app, '');
  await accoglienzaGiaFatta(app);
  await stubProviders(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 15_000 });
  await expect(page.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 20_000 });

  await chiaveNelPortafoglio(app);
  await avvisoCreditiCambiati(app);

  await expect(page.locator('#homeMessage')).not.toContainText(/codice d.invito/i, { timeout: 30_000 });
});

// La direzione opposta, sempre dal portafoglio: la chiave personale sparisce da
// questo computer (deposito perso, chiave revocata). Da quel momento Filo non
// ha più niente con cui rispondere, e la home aperta deve dirlo.
test('la chiave del portafoglio che sparisce: la home aperta lo dice', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await configCondivisa(app, { provider: 'openrouter' });
  await chiaveNelleImpostazioni(app, '');
  await chiaveNelPortafoglio(app);
  await avvisoCreditiCambiati(app);
  await accoglienzaGiaFatta(app);
  await stubProviders(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 15_000 });
  await expect(page.locator('#homeMessage')).toContainText(FRASE_DEL_MODELLO, { timeout: 20_000 });

  await chiaveNelPortafoglio(app, '');
  await avvisoCreditiCambiati(app);

  await expect(page.locator('#homeMessage')).toContainText(/codice d.invito/i, { timeout: 30_000 });
});
