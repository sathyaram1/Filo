// Verifica #1432, giro 2, rilievo 1: con l'Aiuto ridotto, «Ferma» dalla barra laterale ferma la dettatura ma riapre
// il pannello (il testo dettato prende il fuoco), mentre dalla riga del tasto destro resta ridotto. Le due strade concordano.
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

const pannello = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return t && t.aiuto ? t.aiuto.pannello : null;
});

test('r1 Aiuto ridotto: «Ferma» dalla barra ferma la dettatura e lascia il pannello ridotto, come dalla riga del tasto destro', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app);
  await microfonoFinto(shell);
  const page = await testServer.openReady(openTab, SITO);
  await expect.poll(() => pannello(app), { timeout: 8_000 }).toBe('chiuso');
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
  await aiuto.locator('.sn-sidebar-collapse').click();
  await expect(aiuto).toHaveClass(/sn-sidebar-collapsed/);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await expect(help).toHaveAttribute('aria-label', 'Ferma');
  await help.click();
  await expect(mic).toHaveAttribute('data-stato', 'pronto', { timeout: 10_000 });
  await expect(aiuto.locator('textarea')).toHaveValue('una frase', { timeout: 10_000 });
  // L'utente l'aveva ridotto: fermare la dettatura non lo riapre.
  await page.waitForTimeout(600);
  await expect(aiuto).toHaveClass(/sn-sidebar-collapsed/);
  expect(await pannello(app)).toBe('ridotto');
  await expect(help).toHaveAttribute('aria-label', 'Aiuto');
});
