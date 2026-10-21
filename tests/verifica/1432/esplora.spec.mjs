// Esplorazione della verifica #1432 giro 2.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const SHOTS = 'tests/.shots';
const SITO = '<!doctype html><title>Sito</title><body style="margin:0;padding:40px;font:16px sans-serif"><h1>Un sito</h1><p>Testo.</p></body>';
const SITO2 = '<!doctype html><title>Altro</title><body style="margin:0;padding:40px;font:16px sans-serif"><h1>Altro sito</h1></body>';

async function prepara(app, { chiave = true } = {}) {
  await app.evaluate(async (_e, { chiave: k }) => {
    const C = globalThis.SN_CONST;
    const models = { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.HELP]: 'deepseek-flash' };
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: k ? { openrouter: 'k-test' } : {}, models,
      modelRegistry: globalThis.SN_TEST_MODELS.registry, dictation: { autoSend: false },
    });
    if (k) globalThis.SN_PROVIDER_OPENROUTER.transcribe = async () => ({ text: ' ciao ', usage: { seconds: 1, costUsd: 0.00001 }, generationId: null });
    globalThis.__aiuto = { chiamate: 0, rilascia: null };
    const risponde = async ({ attempts, messages }) => {
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (!sistema.includes('# Protocollo di risposta')) return { ...base, text: 'ok' };
      globalThis.__aiuto.chiamate += 1;
      await new Promise((r) => { globalThis.__aiuto.rilascia = r; });
      return { ...base, text: JSON.stringify({ text: 'Ecco la risposta.', status: 'done' }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = risponde;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = risponde;
  }, { chiave });
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
  return t ? { id: t.id, aiuto: t.aiuto || null } : null;
});
const DALLE_PREFERENZE = { tab: { id: 5, url: 'filo://preferences/preferences.html' }, url: 'filo://preferences/preferences.html' };
const imposta = (app, settings) => app.evaluate(async (_e, { s, da }) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: s }, da), { s: settings, da: DALLE_PREFERENZE });
const icona = (barra) => barra.locator('#nav .ico[data-id="help"]');
const lascia = (app) => app.evaluate(() => { const r = globalThis.__aiuto.rilascia; globalThis.__aiuto.rilascia = null; if (r) r(); return !!r; });
const attiva = (app, id) => app.evaluate(({ BrowserWindow }, tid) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  w._filoTabs.activate(tid);
}, id);

test('cambio scheda: icona e striscia seguono la scheda davanti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await prepara(app);
  await microfonoFinto(shell);
  const pageA = await testServer.openReady(openTab, SITO);
  await expect.poll(async () => (await nelMain(app))?.aiuto?.pannello, { timeout: 8_000 }).toBe('chiuso');
  const idA = (await nelMain(app)).id;
  let barra = await barraPage(app);
  await comandaBarra(app, 'clic'); await pannelloFermo(barra);
  await icona(barra).click();
  await expect(pageA.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  await comandaBarra(app, 'chiudi');
  const ta = pageA.locator('.sn-sidebar textarea');
  await ta.click(); await ta.fill('domanda'); await pageA.keyboard.press('Enter');
  await expect.poll(() => app.evaluate(() => globalThis.__aiuto.chiamate), { timeout: 8_000 }).toBeGreaterThan(0);
  await pageA.locator('.sn-sidebar-collapse').click();

  const pageB = await testServer.openReady(openTab, SITO2);
  await expect.poll(async () => (await nelMain(app))?.aiuto?.pannello, { timeout: 8_000 }).toBe('chiuso');
  const idB = (await nelMain(app)).id;
  expect(idB).not.toBe(idA);
  await lascia(app);
  await pageA.waitForTimeout(1000);
  barra = await barraPage(app);
  const strisciaSuB = await barra.locator('#striscia').getAttribute('class');
  console.log('striscia su B con risposta in A:', strisciaSuB);
  await comandaBarra(app, 'clic'); await pannelloFermo(barra);
  console.log('icona su B:', await icona(barra).getAttribute('aria-label'), await icona(barra).getAttribute('data-icona'));
  await icona(barra).click();
  await expect(pageB.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  await expect(icona(barra)).toHaveAttribute('aria-label', 'Parla');
  await comandaBarra(app, 'chiudi');
  await attiva(app, idA);
  await expect.poll(async () => (await nelMain(app))?.id).toBe(idA);
  await expect(barra.locator('#striscia')).toHaveClass(/\brisposta\b/, { timeout: 8_000 });
  await comandaBarra(app, 'clic'); await pannelloFermo(barra);
  await expect(icona(barra)).toHaveAttribute('aria-label', 'Leggi la risposta');
});

test('senza chiave: il secondo clic avvisa', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, { chiave: false });
  await microfonoFinto(shell);
  const page = await testServer.openReady(openTab, SITO);
  await expect.poll(async () => (await nelMain(app))?.aiuto?.pannello, { timeout: 8_000 }).toBe('chiuso');
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic'); await pannelloFermo(barra);
  await icona(barra).click();
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  await icona(barra).click();
  await page.waitForTimeout(2500);
  const stato = await page.locator('.sn-sidebar .sn-voce-btn').getAttribute('data-stato');
  console.log('stato mic senza chiave:', stato);
  await icona(barra).click();
  await page.waitForTimeout(2000);
  const toasts = await page.locator('.sn-toast').allTextContents();
  console.log('toast senza chiave:', JSON.stringify(toasts));
  expect(toasts.length).toBeGreaterThan(0);
});

test('menu del tasto destro con Aiuto spento in Preferenze', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await prepara(app);
  const page = await testServer.openReady(openTab, SITO);
  await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'icon_layout_drop', id: 'help', target: 'primary', beforeId: 'translate' }, {}));
  await imposta(app, { featureFlags: { help: false } });
  await page.waitForTimeout(500);
  await page.locator('h1').click({ button: 'right' });
  const nelMenu = menuDi(page).locator('.sn-menu [data-sn-icon-id="help"]');
  await expect(nelMenu).toBeVisible({ timeout: 8_000 });
  console.log('menu help spento:', await nelMenu.evaluate((el) => ({ label: el.getAttribute('aria-label'), dis: el.getAttribute('aria-disabled') || el.disabled, cls: el.className, title: el.getAttribute('title') })));
});

test('tema scuro: le icone nei tre stati e la striscia', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app);
  await microfonoFinto(shell);
  await imposta(app, { theme: 'dark' });
  const page = await testServer.openReady(openTab, SITO);
  await expect.poll(async () => (await nelMain(app))?.aiuto?.pannello, { timeout: 8_000 }).toBe('chiuso');
  const barra = await barraPage(app);
  mkdirSync(SHOTS, { recursive: true });
  await comandaBarra(app, 'clic'); await pannelloFermo(barra);
  await barra.mouse.move(200, 600);
  await barra.screenshot({ path: `${SHOTS}/v1432-scuro-chiuso.png` });
  await icona(barra).click();
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  await barra.mouse.move(200, 600);
  await barra.waitForTimeout(400);
  await barra.screenshot({ path: `${SHOTS}/v1432-scuro-aperto.png` });
  await icona(barra).click();
  await expect(page.locator('.sn-sidebar .sn-voce-btn')).toHaveAttribute('data-stato', 'ascolta', { timeout: 8_000 });
  await barra.mouse.move(200, 600);
  await barra.waitForTimeout(400);
  await barra.screenshot({ path: `${SHOTS}/v1432-scuro-ascolta.png` });
  await icona(barra).click();
  await expect(page.locator('.sn-sidebar .sn-voce-btn')).toHaveAttribute('data-stato', 'pronto', { timeout: 10_000 });
  await comandaBarra(app, 'chiudi');
  const ta = page.locator('.sn-sidebar textarea');
  await ta.click(); await ta.fill('domanda'); await page.keyboard.press('Enter');
  await expect.poll(() => app.evaluate(() => globalThis.__aiuto.chiamate), { timeout: 8_000 }).toBeGreaterThan(0);
  await page.locator('.sn-sidebar-collapse').click();
  await lascia(app);
  await expect(barra.locator('#striscia')).toHaveClass(/\brisposta\b/, { timeout: 8_000 });
  await shell.screenshot({ path: `${SHOTS}/v1432-scuro-striscia-finestra.png` });
  await comandaBarra(app, 'clic'); await pannelloFermo(barra);
  await barra.mouse.move(200, 600);
  await barra.waitForTimeout(400);
  await barra.screenshot({ path: `${SHOTS}/v1432-scuro-risposta.png` });
});
