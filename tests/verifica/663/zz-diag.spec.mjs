import { test, expect } from '../../fixtures/electron.mjs';

test('diagnostica pesi aperti a home aperta', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
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
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'sk-or-vera' } });
    const M = globalThis.SN_FILO_MEMORY;
    const O = globalThis.SN_ONBOARDING;
    await M.setOnboarding(O.close(O.emptyState(), new Date().toISOString()));
  });
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    const risposta = (attempts) => ({
      text: JSON.stringify({ message: 'Ecco la tua home su misura.', suggestions: [] }),
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    P.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const r = risposta(attempts); try { onDelta && onDelta(r.text); } catch (_) {} return r;
    };
    P.completeWithFallback = async ({ attempts }) => risposta(attempts);
  });

  const deadline = Date.now() + 10_000;
  let page = null;
  while (Date.now() < deadline) {
    page = app.windows().find((x) => x.url().startsWith('filo://newtab'));
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 15_000 });
  await expect(page.locator('#homeMessage')).toContainText('su misura', { timeout: 20_000 });

  // La pagina registra i messaggi che le arrivano dal main.
  await page.evaluate(() => {
    window.__visti = [];
    chrome.runtime.onMessage.addListener((m) => { window.__visti.push(m && m.type); });
  });

  // Prima un aggiornamento innocuo: se il semaforo interno fosse allineato
  // («Filo può rispondere»), qui non deve arrivare nessun filo_ready_changed.
  await page.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.UPDATE_SETTINGS,
      settings: { theme: 'dark' },
    });
  });
  await new Promise((r) => setTimeout(r, 2000));
  const dopoInnocuo = await page.evaluate(() => window.__visti.slice());
  console.log('DIAG dopo innocuo', JSON.stringify(dopoInnocuo));
  await page.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.UPDATE_SETTINGS,
      settings: { openWeightsOnly: true },
    });
  });
  await new Promise((r) => setTimeout(r, 4000));

  const stato = await app.evaluate(async () => {
    const H = globalThis.__filoHandlers;
    const C = globalThis.SN_CONST;
    const eff = await H.getEffectiveSettings();
    const s = await globalThis.SN_STORAGE.getSettings();
    return {
      openWeightsOnly: s.openWeightsOnly,
      effOpenWeights: eff.openWeightsOnly,
      effModels: eff.models,
      effRegistry: Object.keys(eff.modelRegistry || {}),
      canChat: C.canServeAction(eff, C.ACTIONS.FILO_CHAT),
      canHome: C.canServeAction(eff, C.ACTIONS.FILO_DASHBOARD),
      perche: C.whyCannotServe(eff, [C.ACTIONS.FILO_DASHBOARD, C.ACTIONS.FILO_CHAT]),
    };
  });
  const visti = await page.evaluate(() => window.__visti);
  const msg = await page.locator('#homeMessage').textContent();
  console.log('DIAG stato', JSON.stringify(stato));
  console.log('DIAG messaggi visti', JSON.stringify(visti));
  console.log('DIAG home', JSON.stringify(msg));
});
