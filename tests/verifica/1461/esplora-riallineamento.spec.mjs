// Esplorazione del riallineamento #1461: titolo dell'Editor non generato, avviso di main col perché e conto del ramo.
import { test, expect } from '../../fixtures/electron.mjs';

const oggi = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = globalThis.SN_CONTATORI.giornoDi(Date.now());
  const out = {};
  for (const [k, v] of Object.entries(s.ore || {})) {
    if (!k.startsWith(`${g}T`)) continue;
    for (const [e, n] of Object.entries(v.erroriVisti || {})) out[e] = (out[e] || 0) + n;
  }
  return out;
});

test('titolo chiesto a mano coi crediti finiti: avviso col perché e il tasto, e l\'errore si conta', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, openWeightsOnly: false, apiKeys: { openrouter: 'k-test' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      models: { [C.ACTIONS.EDITOR_TITLE]: 'deepseek-flash', [C.ACTIONS.EDITOR_SUMMARY]: 'deepseek-flash' },
    });
    const vero = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (/openrouter\.ai\/api\/v1\/models\/.+\/endpoints$/.test(u)) {
        return new Response(JSON.stringify({ data: { endpoints: [{ provider_name: 'DeepInfra', tag: 'deepinfra', supported_parameters: ['max_tokens'], max_completion_tokens: 65536 }] } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (u.includes('openrouter.ai/api/v1/chat/completions')) {
        return new Response(JSON.stringify({ error: { code: 402, message: 'Insufficient credits', metadata: { provider_name: 'DeepInfra' } } }), { status: 402, headers: { 'content-type': 'application/json' } });
      }
      return vero(url, init);
    };
  });
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.evaluate(() => {
    const d = document.getElementById('doc');
    d.innerHTML = '<p>Il bilancio del trimestre segue le stesse voci del precedente.</p>';
    d.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const prima = await oggi(app);
  await editor.locator('#docTitle').click({ button: 'right' });
  await editor.locator('.ed-title-ctxmenu .sn-select-option', { hasText: 'Rigenera titolo' }).click();
  const toast = editor.locator('.ed-toast', { hasText: 'Non sono riuscito a generare il titolo.' });
  await expect(toast).toBeVisible({ timeout: 20_000 });
  console.log('TOAST', await toast.innerText());
  await expect.poll(async () => {
    const ora = await oggi(app);
    return Object.keys(ora).filter((k) => k.startsWith('modello:') && (ora[k] || 0) > (prima[k] || 0));
  }, { timeout: 10_000 }).not.toEqual([]);
  console.log('ERRORI', JSON.stringify(await oggi(app)));
});
