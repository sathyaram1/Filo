// Diagnosi temporanea (da cancellare prima di registrare la critica).
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

test('diagnosi: invitato poi pesi aperti', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  const azioni = await app.evaluate(() => {
    const A = globalThis.SN_CONST.ACTIONS;
    return { chat: A.FILO_CHAT, home: A.FILO_DASHBOARD };
  });
  await app.evaluate(async (_e, cfg) => {
    const Defaults = globalThis.__filoDefaults;
    const orig = globalThis.__filoDefaultsOrigGet || Defaults.get;
    globalThis.__filoDefaultsOrigGet = orig;
    Defaults.get = () => ({ ...orig(), ...cfg });
  }, {
    provider: 'openrouter',
    models: { [azioni.chat]: 'chiuso', [azioni.home]: 'chiuso' },
    modelRegistry: { chiuso: { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' } },
  });
  await app.evaluate((_e, k) => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    req('./auth/wallet-store').personalKey = () => k;
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

  // Spia: quali messaggi arrivano alla home.
  await page.evaluate(() => {
    window.__visti = [];
    chrome.runtime.onMessage.addListener((m) => { window.__visti.push(m && m.type); });
  });
  await page.reload();
  await page.evaluate(() => {
    window.__visti = [];
    chrome.runtime.onMessage.addListener((m) => { window.__visti.push(m && m.type); });
  });
  await expect(page.locator('#homeMessage')).toContainText('su misura', { timeout: 20_000 });

  await page.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { openWeightsOnly: true },
    });
  });
  await new Promise((r) => setTimeout(r, 4000));

  const diag = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const s = await globalThis.SN_STORAGE.getSettings();
    return {
      openWeightsOnly: s.openWeightsOnly,
      useDefaultModels: s.useDefaultModels,
      apiKeysUtente: Object.keys(s.apiKeys || {}),
    };
  });
  const visti = await page.evaluate(() => window.__visti);
  const testo = await page.evaluate(() => document.getElementById('homeMessage').textContent);
  console.log('DIAG storage:', JSON.stringify(diag));
  console.log('DIAG messaggi alla home:', JSON.stringify(visti));
  console.log('DIAG testo home:', testo);
});
