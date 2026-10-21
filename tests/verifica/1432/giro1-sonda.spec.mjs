// Verifica #1432, giro 1: sonde sull'icona Aiuto della barra laterale.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { barraPage, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

const SHOTS = 'tests/.shots/verifica-1432';
const DETTO = 'dove si cambia la password';
const RISPOSTA = 'In alto a destra, sotto il tuo nome.';
const SITO = '<!doctype html><title>Sito</title><body style="margin:0;padding:40px;font:16px sans-serif"><h1>Un sito</h1><p>Testo.</p></body>';

async function prepara(app) {
  await app.evaluate(async (_e, { detto, risposta }) => {
    const C = globalThis.SN_CONST;
    const models = { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.HELP]: 'deepseek-flash' };
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models,
      modelRegistry: globalThis.SN_TEST_MODELS.registry, dictation: { autoSend: false },
    });
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async () => ({ text: ` ${detto} `, usage: { seconds: 1, costUsd: 0.00001 }, generationId: null });
    globalThis.__aiuto = { chiamate: 0, rilascia: null };
    const risponde = async ({ attempts, messages }) => {
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (!sistema.includes('# Protocollo di risposta')) return { ...base, text: 'ok' };
      globalThis.__aiuto.chiamate += 1;
      await new Promise((r) => { globalThis.__aiuto.rilascia = r; });
      return { ...base, text: JSON.stringify({ text: risposta, status: 'done' }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = risponde;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = risponde;
  }, { detto: DETTO, risposta: RISPOSTA });
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

const DALLE_PREFERENZE = { tab: { id: 5, url: 'filo://preferences/preferences.html' }, url: 'filo://preferences/preferences.html' };
const imposta = (app, settings) => app.evaluate(async (_e, { s, da }) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: s }, da), { s: settings, da: DALLE_PREFERENZE });
const nelMain = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return t ? { aiuto: t.aiuto || null } : null;
});
const icona = (barra) => barra.locator('#nav .ico[data-id="help"]');

async function sito(app, openTab, testServer) {
  const page = await testServer.openReady(openTab, SITO);
  await expect.poll(async () => (await nelMain(app))?.aiuto?.pannello, { timeout: 8_000 }).toBe('chiuso');
  return page;
}

test('sonda: Aiuto ridotto mentre detta, l\'icona fa quello che dice', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app);
  await microfonoFinto(shell);
  const page = await sito(app, openTab, testServer);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const help = icona(barra);
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
  const etichetta = await help.getAttribute('aria-label');
  console.log('etichetta a pannello ridotto mentre detta:', etichetta, await mic.getAttribute('data-stato'));
  await help.click();
  await page.waitForTimeout(800);
  console.log('dopo il clic:', await mic.getAttribute('data-stato'), await aiuto.getAttribute('class'));
  if (etichetta === 'Ferma') await expect(mic).not.toHaveAttribute('data-stato', 'ascolta');
});

test('sonda: tema scuro, le icone e la striscia', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app);
  await microfonoFinto(shell);
  await imposta(app, { theme: 'dark' });
  const page = await sito(app, openTab, testServer);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  mkdirSync(SHOTS, { recursive: true });
  const help = icona(barra);
  await barra.screenshot({ path: `${SHOTS}/scuro-chiuso.png` });
  await help.click();
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  await expect(help).toHaveAttribute('data-icona', 'mic');
  await barra.screenshot({ path: `${SHOTS}/scuro-aperto.png` });
  await help.click();
  await expect(help).toHaveClass(/\bascolta\b/, { timeout: 8_000 });
  await barra.screenshot({ path: `${SHOTS}/scuro-ascolta.png` });
  await help.click();
  await expect(help).not.toHaveClass(/\bascolta\b/, { timeout: 10_000 });
  await help.hover();
  await page.waitForTimeout(900);
  await barra.screenshot({ path: `${SHOTS}/scuro-hover.png` });
});
