// #1345: quando il router rifiuta un modello la chat e il «Prova» delle Opzioni dicono la causa vera, non il messaggio
// grezzo né «fornitori non ammessi» al posto di «il modello non legge le immagini». Regole pure: unit/rifiutoIngresso.test.mjs.

import { test, expect } from './fixtures/electron.mjs';

const NEGATO = 'acme/negato';

// Il router finto nel main: una richiesta con immagini riceve il 404 di chi non le legge; il modello NEGATO quello dei
// fornitori non ammessi (dalle impostazioni dell'account, non dalla politica di Filo: i suoi host dichiarati sono ammessi).
async function preparaRouter(app, { tema = 'light' } = {}) {
  await app.evaluate(async (_e, { NEGATO, tema }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      theme: tema,
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry, 'negato-x': { provider: 'openrouter', model: NEGATO } },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
    });
    globalThis.SN_PROVIDER_OPENROUTER.forgetModelHosts();
    globalThis.__conImmagini = 0;
    if (globalThis.__fetchVero) return;
    globalThis.__fetchVero = globalThis.fetch;
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (/openrouter\.ai\/api\/v1\/models\/.+\/endpoints$/.test(u)) {
        return json({ data: { endpoints: [{ provider_name: 'DeepInfra', tag: 'deepinfra', supported_parameters: ['tools', 'reasoning', 'max_tokens'] }] } });
      }
      if (!u.includes('openrouter.ai/api/v1/chat/completions')) return globalThis.__fetchVero(url, init);
      const body = JSON.parse(init.body);
      const foto = (body.messages || []).some((m) => Array.isArray(m.content) && m.content.some((p) => p && p.type === 'image_url'));
      if (foto) {
        globalThis.__conImmagini++;
        return json({ error: { code: 404, message: 'No endpoints found that support image input' } }, 404);
      }
      if (body.model === NEGATO) return json({ error: { code: 404, message: 'No allowed providers are available for the selected model.' } }, 404);
      if (body.stream) {
        const sse = `data: ${JSON.stringify({ provider: 'DeepInfra', choices: [{ delta: { content: 'Ecco fatto.' } }] })}\n\ndata: [DONE]\n\n`;
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return json({ provider: 'DeepInfra', choices: [{ message: { content: 'Ecco fatto.' } }], usage: {} });
    };
  }, { NEGATO, tema });
}

async function apriHome(openTab) {
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeVisible({ timeout: 10_000 });
  return home;
}

// Una foto vera, fatta da un canvas e incollata come dagli appunti.
async function incollaFoto(home) {
  await home.evaluate(async () => {
    const dt = new DataTransfer();
    const cv = new OffscreenCanvas(16, 16);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(0, 0, 16, 16);
    dt.items.add(new File([await cv.convertToBlob({ type: 'image/png' })], 'foto.png', { type: 'image/png' }));
    document.getElementById('inputForm').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(home.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1, { timeout: 5000 });
}

for (const tema of ['light', 'dark']) {
  test(`una foto a un modello che non legge le immagini: la chat dice questo, non i fornitori (${tema})`, async ({ app, openTab }) => {
    test.setTimeout(90_000);
    await preparaRouter(app, { tema });
    const home = await apriHome(openTab);
    await incollaFoto(home);
    await home.locator('#input').fill('cosa c’è qui?');
    await home.locator('#sendBtn').click();
    const bolla = home.locator('.dash-bubble-filo', { hasText: 'non legge le immagini' });
    await expect(bolla).toBeVisible({ timeout: 15_000 });
    await expect(bolla).toContainText('Il modello scelto non legge le immagini');
    await expect(bolla).toContainText('Opzioni → Modelli per azione');
    await expect(bolla).not.toContainText(/fornitor|ammess|OpenRouter 404/);
    await expect(bolla.getByRole('button', { name: 'Apri Opzioni' })).toBeVisible();
    expect(await app.evaluate(() => globalThis.__conImmagini)).toBeGreaterThan(0);
    await home.waitForTimeout(300);
    await home.screenshot({ path: `tests/.shots/1345-chat-immagini-${tema}.png` });

    // Senza la foto lo stesso modello risponde: la causa detta era quella vera.
    await home.locator('#input').fill('allora dimmi solo ciao');
    await home.locator('#sendBtn').click();
    await expect(home.locator('.dash-bubble-filo', { hasText: 'Ecco fatto.' })).toBeVisible({ timeout: 15_000 });
  });
}

test('il «Prova» di una riga delle Opzioni rifiutata dal router dice la causa come la chat, non il JSON del servizio', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await preparaRouter(app);
  const page = await openTab('filo://options/options.html');
  await page.waitForSelector('#sec-model-registry:not([hidden])', { timeout: 8_000 });
  await page.waitForFunction((id) => [...document.querySelectorAll('#modelRegistryList .sn-model-id')].some((i) => i.value === id), NEGATO, { timeout: 8_000 });
  await page.evaluate((id) => {
    const input = [...document.querySelectorAll('#modelRegistryList .sn-model-id')].find((i) => i.value === id);
    input.closest('.sn-model-row').dataset.provaNegato = '1';
  }, NEGATO);
  const riga = page.locator('#modelRegistryList .sn-model-row[data-prova-negato="1"]');
  await riga.locator('.sn-model-test').click();
  const stato = riga.locator('.sn-model-row-status');
  await expect(stato).toContainText('Nessun fornitore di questo modello è fra quelli ammessi', { timeout: 15_000 });
  await expect(stato).toContainText('impostazioni del tuo account OpenRouter');
  await expect(stato).not.toContainText(/OpenRouter 404|\{"error"/);
  // La chat sullo stesso modello dice la stessa cosa.
  const r = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({ models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'negato-x' } });
    return globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.FILO_CHAT, userMessage: 'ciao', threadHistory: [] }, { url: 'filo://newtab/newtab.html' });
  });
  expect(r.ok).toBe(false);
  const testoProva = (await stato.textContent()).replace(/^.*?Test fallito: /, '');
  expect(testoProva).toBe(r.error);
  await riga.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/1345-prova-fornitori.png' });
});
