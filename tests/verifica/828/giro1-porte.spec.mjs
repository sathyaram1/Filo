// Verifica #828, giro 1: le altre strade della stessa frase (riquadri sulle pagine web, modelli predefiniti).
import { test, expect } from '../../fixtures/electron.mjs';
import { statoDi } from '../../helpers/riquadri.mjs';

const GEMINI = 'google/gemini-2.5-flash';
const PAGINA = '<!doctype html><meta charset="utf-8"><title>Pagina</title><p id="p">Una frase con dentro la parola sonda.</p>';
const BOLLA = '.sn-popup .sn-msg-assistant .sn-msg-text';

async function router(app, { predefiniti }) {
  await app.evaluate(async (_e, { GEMINI, predefiniti }) => {
    const C = globalThis.SN_CONST;
    const models = {};
    for (const a of Object.values(C.ACTIONS)) models[a] = 'gemini-x';
    const registry = { 'gemini-x': { provider: 'openrouter', model: GEMINI } };
    if (predefiniti) {
      const D = globalThis.__filoDefaults;
      const orig = globalThis.__filoDefaultsOrigGet || D.get;
      globalThis.__filoDefaultsOrigGet = orig;
      D.get = () => ({ ...orig(), provider: 'openrouter', models, modelRegistry: registry });
      await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'k-test' }, openWeightsOnly: false });
    } else {
      await globalThis.SN_STORAGE.updateSettings({
        useDefaultModels: false, openWeightsOnly: false, apiKeys: { openrouter: 'k-test' },
        modelRegistry: { ...globalThis.SN_TEST_MODELS.registry, ...registry },
        models: { ...globalThis.SN_TEST_MODELS.models, ...models },
      });
    }
    globalThis.SN_PROVIDER_OPENROUTER.forgetModelHosts();
    if (globalThis.__fetchVero) return;
    globalThis.__fetchVero = globalThis.fetch;
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (/openrouter\.ai\/api\/v1\/models\/.+\/endpoints$/.test(u)) {
        return json({ data: { endpoints: [{ provider_name: 'Google AI Studio', tag: 'google-ai-studio' }, { provider_name: 'Google Vertex', tag: 'google-vertex' }] } });
      }
      if (!u.includes('openrouter.ai/api/v1/chat/completions')) return globalThis.__fetchVero(url, init);
      return json({ error: { code: 404, message: 'No allowed providers are available for the selected model.' } }, 404);
    };
  }, { GEMINI, predefiniti });
}

async function comandoAllaPagina(app, msg) {
  await app.evaluate(({ BrowserWindow }, m) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w._filoTabs) continue;
      for (const t of w._filoTabs.tabs) {
        const wc = t.view.webContents;
        if (wc.getURL().startsWith('http')) wc.mainFrame.send('filo:broadcast', m);
      }
    }
  }, msg);
}

async function seleziona(page) {
  await page.evaluate(() => {
    const n = document.getElementById('p').firstChild;
    const r = document.createRange();
    r.setStart(n, 26); r.setEnd(n, 31);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
}

for (const [nome, comando] of [['spiega', 'explain-selection'], ['traduci', 'translate-selection']]) {
  test(`${nome} su una pagina web: la frase nuova con la funzione e il tasto per le Opzioni`, async ({ app, openTab, testServer }) => {
    test.setTimeout(120_000);
    await router(app, { predefiniti: false });
    const page = await testServer.openReady(openTab, PAGINA);
    await seleziona(page);
    await comandoAllaPagina(app, { type: 'shortcut_triggered', command: comando });
    const testo = async () => (await statoDi(app, page, BOLLA))?.testo || '';
    await expect.poll(testo, { timeout: 40_000 }).toMatch(/nessun fornitore ammesso lo ospita/);
    const t = await testo();
    console.log(`[${nome}]`, t);
    expect(t).toMatch(/^La funzione «[^»]+» non può usare «google\/gemini-2\.5-flash»/);
    expect(t).toContain('Opzioni → Modelli per azione');
    expect(t).not.toMatch(/riprov/i);
    await expect.poll(async () => !!(await statoDi(app, page, '.sn-popup .sn-msg-rimedio'))?.visibile, { timeout: 10_000 }).toBe(true);
  });
}

test('aiuto (sidebar) su una pagina web: la frase nuova', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await router(app, { predefiniti: false });
  const page = await testServer.openReady(openTab, PAGINA);
  await comandoAllaPagina(app, { type: 'top_frame_command', surface: 'help' });
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 20_000 });
  await page.fill('.sn-sidebar-input textarea', 'cosa posso fare qui?');
  await page.press('.sn-sidebar-input textarea', 'Enter');
  const bolla = page.locator('.sn-sidebar-msg-error').last();
  await expect(bolla).toContainText('nessun fornitore ammesso lo ospita', { timeout: 40_000 });
  const t = await bolla.textContent();
  console.log('[aiuto]', t);
  expect(t).toMatch(/La funzione «[^»]+» non può usare/);
  expect(t).not.toMatch(/riprov/i);
});

test('modelli predefiniti, chat della home: la frase dice di togliere i predefiniti', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  let page = null;
  const deadline = Date.now() + 10_000;
  while (!page && Date.now() < deadline) {
    page = app.windows().find((w) => w.url().startsWith('filo://newtab')) || null;
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  await page.waitForLoadState('domcontentloaded');
  await router(app, { predefiniti: true });
  await page.locator('#input').fill('ciao');
  await page.locator('#sendBtn').click();
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'nessun fornitore ammesso' });
  await expect(bolla).toBeVisible({ timeout: 20_000 });
  const t = await bolla.textContent();
  console.log('[predefiniti]', t);
  expect(t).toContain('togli «Usa modelli predefiniti»');
  expect(t.replace(/↻\s*Riprova/g, '')).not.toMatch(/riprov/i);
  await page.screenshot({ path: 'tests/.shots/828-v-predefiniti.png' });
});
