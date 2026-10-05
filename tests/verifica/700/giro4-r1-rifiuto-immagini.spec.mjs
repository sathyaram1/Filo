// Verifica #700 giro 4, rilievo 1: un rifiuto «nessun host» del router che non riguarda fornitori né strumenti
// (qui: il modello non legge immagini) non va raccontato come esclusione dei fornitori.
import { test, expect } from '../../fixtures/electron.mjs';

const NO_PARAMS = 'No endpoints found that can handle the requested parameters.';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

// Il router finto nel main: registra ogni corpo e risponde secondo `modo`
// ('ok' | 'senza-ragionamento' = nessun host regge `reasoning` | 'nessuno' = ogni richiesta con strumenti riceve `rifiuto`).
async function preparaRouter(app, modo, rifiuto = NO_PARAMS) {
  await app.evaluate(async (_e, { modo, rifiuto }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
    });
    globalThis.__routerModo = modo;
    globalThis.__rifiuto = rifiuto;
    globalThis.__corpi = [];
    if (!globalThis.__fetchVero) {
      globalThis.__fetchVero = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        if (!String(url).includes('openrouter.ai/api/v1/chat/completions')) return globalThis.__fetchVero(url, init);
        const body = JSON.parse(init.body);
        globalThis.__corpi.push(body);
        const m = globalThis.__routerModo;
        const rifiuta = body.tools && (m === 'nessuno' || (m === 'senza-ragionamento' && body.reasoning));
        if (rifiuta) {
          return new Response(JSON.stringify({ error: { code: 404, message: globalThis.__rifiuto } }), { status: 404, headers: { 'content-type': 'application/json' } });
        }
        if (body.stream) {
          const sse = `data: ${JSON.stringify({ provider: 'DeepInfra', choices: [{ delta: { content: 'Ecco fatto.' } }] })}\n\ndata: [DONE]\n\n`;
          return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }
        return new Response(JSON.stringify({ provider: 'DeepInfra', choices: [{ message: { content: 'Ecco fatto.' } }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
      };
    }
  }, { modo, rifiuto });
}


test('il rifiuto per le immagini non viene raccontato come fornitori esclusi', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await preparaRouter(app, 'nessuno', 'No endpoints found that support image input');

  await page.locator('#input').fill('cosa vedi in questa foto?');
  await page.locator('#sendBtn').click();
  const bolla = page.locator('.dash-bubble-filo').last();
  await expect(bolla).toContainText('Modelli predefiniti', { timeout: 15_000 });
  await expect(bolla).not.toContainText('fra quelli ammessi');
  await expect(bolla).toContainText(/immagin/i);
});
