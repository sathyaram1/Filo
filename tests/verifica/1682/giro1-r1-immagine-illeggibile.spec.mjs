// Verifica #1682, giro 1: un modello che legge le immagini e rifiuta UNA foto (rovinata, formato che non digerisce) non
// va presentato come «il modello non legge le immagini»: cambiare modello non è il rimedio, e quello scelto le legge.

import { test, expect } from '../../fixtures/electron.mjs';

async function preparaRouter(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'glm' },
    });
    globalThis.SN_PROVIDER_OPENROUTER.forgetModelHosts();
    globalThis.__conImmagini1682 = 0;
    if (globalThis.__fetchVero1682) return;
    globalThis.__fetchVero1682 = globalThis.fetch;
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (/openrouter\.ai\/api\/v1\/models\/.+\/endpoints$/.test(u)) {
        return json({ data: { endpoints: [{ provider_name: 'DeepInfra', tag: 'deepinfra', supported_parameters: ['tools', 'reasoning', 'max_tokens'] }] } });
      }
      if (!u.includes('openrouter.ai/api/v1/chat/completions')) return globalThis.__fetchVero1682(url, init);
      const body = JSON.parse(init.body);
      const foto = (body.messages || []).some((m) => Array.isArray(m.content) && m.content.some((p) => p && p.type === 'image_url'));
      if (foto) {
        globalThis.__conImmagini1682++;
        // Il rifiuto che un host che legge le immagini dà a una foto che non riesce ad aprire.
        return json({ error: { code: 400, message: 'Provider returned error', metadata: { raw: '{"error":{"code":400,"message":"Unable to process input image. Please retry or report in https://developers.generativeai.google/guide/troubleshooting","status":"INVALID_ARGUMENT"}}', provider_name: 'DeepInfra' } } }, 400);
      }
      if (body.stream) {
        const sse = `data: ${JSON.stringify({ provider: 'DeepInfra', choices: [{ delta: { content: 'Ecco fatto.' } }] })}\n\ndata: [DONE]\n\n`;
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return json({ provider: 'DeepInfra', choices: [{ message: { content: 'Ecco fatto.' } }], usage: {} });
    };
  });
}

test('r1 una foto che il modello (che legge le immagini) non riesce ad aprire: la chat non dice che il modello non legge le immagini', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await preparaRouter(app);
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeVisible({ timeout: 10_000 });
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
  await home.locator('#input').fill('cosa c’è qui?');
  await home.locator('#sendBtn').click();
  await expect.poll(() => app.evaluate(() => globalThis.__conImmagini1682), { timeout: 15_000 }).toBeGreaterThan(0);
  const ultima = home.locator('.dash-bubble-filo').last();
  await expect(ultima).toBeVisible({ timeout: 15_000 });
  await home.waitForTimeout(1500);
  const testo = (await ultima.textContent()) || '';
  console.log('BOLLA r1:', testo);
  expect(testo, 'il modello scelto le immagini le legge').not.toMatch(/non legge le immagini|scegline uno che le legga/);
});
