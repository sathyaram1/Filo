// Diagnosi temporanea (da cancellare prima della consegna).
import { test, expect } from '../../fixtures/electron.mjs';

async function newtab(app) {
  const scadenza = Date.now() + 10_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => x.url().startsWith('filo://newtab'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('diagnosi: invitato poi predefiniti spenti', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  await app.evaluate(async () => {
    const Defaults = globalThis.__filoDefaults;
    const orig = globalThis.__filoDefaultsOrigGet || Defaults.get;
    globalThis.__filoDefaultsOrigGet = orig;
    Defaults.get = () => ({ ...orig(), provider: 'openrouter' });
  });
  await app.evaluate((_e, k) => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    req('./auth/wallet-store').save({ key: k, pseudonym: 'prova' });
  }, 'sk-or-personale');
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    const O = globalThis.SN_ONBOARDING;
    await M.setOnboarding(O.close(O.emptyState(), new Date().toISOString()));
  });
  await app.evaluate((_e, frase) => {
    const P = globalThis.SN_PROVIDERS;
    const risposta = (attempts) => ({
      text: JSON.stringify({ message: frase, suggestions: [] }),
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    P.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const r = risposta(attempts); try { onDelta && onDelta(r.text); } catch (_) {} return r;
    };
    P.completeWithFallback = async ({ attempts }) => risposta(attempts);
  }, 'Ecco la tua home su misura.');
  await page.reload();
  await page.evaluate(() => {
    window.__visti = [];
    chrome.runtime.onMessage.addListener((m) => { window.__visti.push(m && m.type); });
  });
  await expect(page.locator('#homeMessage')).toContainText('su misura', { timeout: 20_000 });

  await page.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { useDefaultModels: false },
    });
  });
  await new Promise((r) => setTimeout(r, 5000));

  const diag = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    const s = await req('./services/handlers.js').getEffectiveSettings?.();
    const grezzo = await globalThis.SN_STORAGE.getSettings();
    return {
      useDefaultModels: grezzo.useDefaultModels,
      modelliGrezzi: Object.values(grezzo.models || {}).filter(Boolean).length,
      registroGrezzo: Object.keys(grezzo.modelRegistry || {}).length,
      chiaviGrezze: grezzo.apiKeys,
      effettivo: s ? {
        chiavi: s.apiKeys,
        modelli: Object.values(s.models || {}).filter(Boolean).length,
        registro: Object.keys(s.modelRegistry || {}).length,
        puoChat: C.canServeAction(s, C.ACTIONS.FILO_CHAT),
        puoHome: C.canServeAction(s, C.ACTIONS.FILO_DASHBOARD),
      } : 'getEffectiveSettings non esportata',
    };
  });
  console.log('DIAG:', JSON.stringify(diag, null, 1));
  console.log('DIAG messaggi:', JSON.stringify(await page.evaluate(() => window.__visti)));
  console.log('DIAG home:', await page.evaluate(() => document.getElementById('homeMessage').textContent));
});
