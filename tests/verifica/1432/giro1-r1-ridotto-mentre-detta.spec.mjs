// Verifica #1432, giro 1, rilievo 1: con l'Aiuto ridotto mentre detta, l'icona della barra dice «Ferma»
// ma il clic riapre il pannello e il microfono resta acceso. Hover e clic devono dire e fare la stessa cosa.
import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

const SITO = '<!doctype html><title>Sito</title><body style="margin:0;padding:40px;font:16px sans-serif"><h1>Un sito</h1><p>Testo.</p></body>';

async function prepara(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const models = { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.HELP]: 'deepseek-flash' };
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models,
      modelRegistry: globalThis.SN_TEST_MODELS.registry, dictation: { autoSend: false },
    });
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async () => ({ text: ' una frase ', usage: { seconds: 1, costUsd: 0.00001 }, generationId: null });
  });
}

async function microfonoFinto(shell) {
  await shell.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      const dest = ac.createMediaStreamDestination();
      osc.connect(dest); osc.start();
      try { await ac.resume(); } catch (_) {}
      return dest.stream;
    };
  });
}

const nelMain = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return t ? { aiuto: t.aiuto || null } : null;
});

test('r1 Aiuto ridotto mentre detta: il clic sull\'icona fa quello che il suo suggerimento dice', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app);
  await microfonoFinto(shell);
  const page = await testServer.openReady(openTab, SITO);
  await expect.poll(async () => (await nelMain(app))?.aiuto?.pannello, { timeout: 8_000 }).toBe('chiuso');
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const help = barra.locator('#nav .ico[data-id="help"]');
  await help.click();
  const aiuto = page.locator('.sn-sidebar');
  await expect(aiuto).toBeVisible({ timeout: 8_000 });
  await help.click();
  const mic = aiuto.locator('.sn-voce-btn');
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 8_000 });

  // Mentre detta, l'utente riduce il pannello con ▾.
  await aiuto.locator('.sn-sidebar-collapse').click();
  await expect(aiuto).toHaveClass(/sn-sidebar-collapsed/);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await expect.poll(async () => (await nelMain(app))?.aiuto?.pannello).toBe('ridotto');
  const detto = await help.getAttribute('aria-label');
  await help.click();
  if (detto === 'Ferma') {
    // L'icona prometteva di fermare: il microfono si spegne.
    await expect(mic).not.toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  } else {
    // L'icona prometteva di aprire: il pannello torna intero.
    await expect(aiuto).not.toHaveClass(/sn-sidebar-collapsed/, { timeout: 5_000 });
  }
});
