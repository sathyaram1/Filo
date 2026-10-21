// Verifica #1432 giro 3: esplorazione (pagine di Filo, clic in fretta, × mentre detta, tema scuro, tastiera).

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync, appendFileSync } from 'node:fs';
const log = (...a) => appendFileSync('/tmp/claude-0/-home-user-Filo/ea101c14-5296-5ff6-bc24-01d3dcd21a26/scratchpad/probe.log', a.join(' ') + '\n');
import { barraPage, statoBarra, comandaBarra, pannelloFermo, premi } from '../../helpers/barra.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const SHOTS = 'tests/.shots/verifica-1432';
const SITO = '<!doctype html><title>Sito</title><body style="margin:0;padding:40px;font:16px sans-serif"><h1>Un sito</h1><p>Testo.</p></body>';

async function prepara(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const models = { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.HELP]: 'deepseek-flash' };
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models,
      modelRegistry: globalThis.SN_TEST_MODELS.registry, dictation: { autoSend: false },
    });
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async () => ({ text: ' ciao ', usage: { seconds: 1, costUsd: 0 }, generationId: null });
    globalThis.__aiuto = { rilascia: null, chiamate: 0 };
    const risponde = async ({ attempts, messages }) => {
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (!sistema.includes('# Protocollo di risposta')) return { ...base, text: 'ok' };
      globalThis.__aiuto.chiamate += 1;
      await new Promise((r) => { globalThis.__aiuto.rilascia = r; });
      return { ...base, text: JSON.stringify({ text: 'Risposta.', status: 'done' }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = risponde;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = risponde;
  });
}
async function microfonoFinto(shell) {
  await shell.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const osc = ac.createOscillator(); osc.frequency.value = 220;
      const gain = ac.createGain(); gain.gain.value = 0.4;
      const dest = ac.createMediaStreamDestination();
      osc.connect(gain); gain.connect(dest); osc.start();
      try { await ac.resume(); } catch (_) {}
      return dest.stream;
    };
  });
}
const nelMain = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  return t ? { aiuto: t.aiuto || null, url: t.view.webContents.getURL() } : null;
});
async function barraAperta(app) {
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  return barra;
}
const icona = (barra) => barra.locator('#nav .ico[data-id="help"]');
const leggi = async (help) => ({
  label: await help.getAttribute('aria-label'), dis: await help.getAttribute('aria-disabled'),
  sugg: await help.getAttribute('data-sugg'), ic: await help.getAttribute('data-icona'),
});

test('pagine di Filo: Preferenze e Cronologia', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await prepara(app);
  for (const url of ['filo://preferences/preferences.html', 'filo://history/history.html']) {
    const page = await openTab(url);
    await page.waitForTimeout(2500);
    const barra = await barraAperta(app);
    const help = icona(barra);
    log('PAGINA', url, JSON.stringify(await leggi(help)), JSON.stringify(await nelMain(app)));
    await comandaBarra(app, 'chiudi');
    await page.mouse.click(300, 300, { button: 'right' });
    await page.waitForTimeout(800);
    const m = menuDi(page);
    log('MENU', url, await m.voci.count(), JSON.stringify(await m.voci.allInnerTexts().catch(() => [])), await m.locator('.sn-menu [data-sn-icon-id="help"]').count());
    await page.keyboard.press('Escape');
    await comandaBarra(app, 'clic');
    await pannelloFermo(barra);
    if ((await help.getAttribute('aria-disabled')) === 'false') {
      await help.click();
      await page.waitForTimeout(1200);
      log('DOPO CLIC', url, await page.locator('.sn-sidebar').count(), JSON.stringify(await leggi(help)));
    }
    await comandaBarra(app, 'chiudi');
  }
});

test('tre clic in fretta e × mentre detta', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app);
  await microfonoFinto(shell);
  const page = await testServer.openReady(openTab, SITO);
  await expect.poll(async () => (await nelMain(app))?.aiuto?.pannello, { timeout: 8_000 }).toBe('chiuso');
  const barra = await barraAperta(app);
  const help = icona(barra);
  await help.click();
  await help.click({ delay: 0 });
  await help.click({ delay: 0 });
  await page.waitForTimeout(2500);
  const mic = page.locator('.sn-sidebar .sn-voce-btn');
  log('FRETTA', await mic.getAttribute('data-stato'), JSON.stringify(await leggi(help)), JSON.stringify((await nelMain(app)).aiuto));
  // Ora dettatura e ×.
  if ((await mic.getAttribute('data-stato')) !== 'ascolta') await help.click();
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 8_000 });
  await page.waitForTimeout(800);
  await page.locator('.sn-sidebar-close').click();
  await page.waitForTimeout(1500);
  log('CHIUSO', await page.locator('.sn-sidebar').count(), JSON.stringify(await leggi(help)), JSON.stringify((await nelMain(app)).aiuto));
  const tracce = await shell.evaluate(() => 0);
  log('tracce', tracce);
  // Riapre e detta di nuovo.
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await help.click();
  await expect(page.locator('.sn-sidebar')).toBeVisible();
  await help.click();
  await expect(page.locator('.sn-sidebar .sn-voce-btn')).toHaveAttribute('data-stato', 'ascolta', { timeout: 8_000 });
  // Esc nella pagina mentre detta.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  log('ESC', await page.locator('.sn-sidebar').count(), await page.locator('.sn-sidebar .sn-voce-btn').getAttribute('data-stato').catch(() => 'nessuno'), JSON.stringify(await leggi(help)));
});

test('tastiera: Ctrl+Shift+B e Invio sull\'icona Aiuto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app);
  await microfonoFinto(shell);
  const page = await testServer.openReady(openTab, SITO);
  await expect.poll(async () => (await nelMain(app))?.aiuto?.pannello, { timeout: 8_000 }).toBe('chiuso');
  const barra = await barraPage(app);
  for (let i = 0; i < 3; i++) try {
    await comandaBarra(app, 'tasto');
    await pannelloFermo(barra).catch(() => {});
    const f = await barra.evaluate(() => document.activeElement && (document.activeElement.dataset.id || document.activeElement.id));
    await barra.locator('#nav .ico[data-id="help"]').focus();
    await premi(app, 'barra', 'Return');
    await page.waitForTimeout(1500);
    log('TASTO', i, f, await page.locator('.sn-sidebar').count(), await page.locator('.sn-sidebar .sn-voce-btn').getAttribute('data-stato').catch(() => '-'), (await statoBarra(app)).aperta, JSON.stringify((await nelMain(app)).aiuto));
  }
});

test('tema scuro: i tre stati e la striscia', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app);
  await microfonoFinto(shell);
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  const page = await testServer.openReady(openTab, SITO);
  await expect.poll(async () => (await nelMain(app))?.aiuto?.pannello, { timeout: 8_000 }).toBe('chiuso');
  mkdirSync(SHOTS, { recursive: true });
  const barra = await barraAperta(app);
  const help = icona(barra);
  await help.hover();
  await page.waitForTimeout(900);
  await shell.screenshot({ path: `${SHOTS}/scuro-chiuso-finestra.png` });
  await barra.screenshot({ path: `${SHOTS}/scuro-chiuso.png` });
  await help.click();
  await page.waitForTimeout(900);
  await barra.screenshot({ path: `${SHOTS}/scuro-aperto.png` });
  await help.click();
  await expect(page.locator('.sn-sidebar .sn-voce-btn')).toHaveAttribute('data-stato', 'ascolta', { timeout: 8_000 });
  await page.waitForTimeout(600);
  await barra.screenshot({ path: `${SHOTS}/scuro-ascolta.png` });
  await help.click();
  await page.waitForTimeout(1500);
  await comandaBarra(app, 'chiudi');
  const ta = page.locator('.sn-sidebar textarea');
  await ta.click(); await ta.fill('ciao?'); await page.keyboard.press('Enter');
  await expect.poll(() => app.evaluate(() => globalThis.__aiuto.chiamate)).toBeGreaterThan(0);
  await page.locator('.sn-sidebar-collapse').click();
  await app.evaluate(() => globalThis.__aiuto.rilascia && globalThis.__aiuto.rilascia());
  await expect(barra.locator('#striscia')).toHaveClass(/risposta/, { timeout: 8_000 });
  await page.waitForTimeout(600);
  await shell.screenshot({ path: `${SHOTS}/scuro-striscia-finestra.png` });
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.screenshot({ path: `${SHOTS}/scuro-risposta.png` });
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
  await page.waitForTimeout(600);
  await barra.screenshot({ path: `${SHOTS}/chiaro-risposta.png` });
  await comandaBarra(app, 'chiudi');
  await page.waitForTimeout(600);
  await shell.screenshot({ path: `${SHOTS}/chiaro-striscia-finestra.png` });
});
