// Verifica #1307.3, giro 2: la scheda letta in parte con la prima parte senza testo, quando la rete dà una copia diversa.
import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

async function stubModello(app, piani) {
  await app.evaluate(async (_e, piani) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ text: '', actions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const n = globalThis.__chiamate.push(JSON.parse(JSON.stringify(messages))) - 1;
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      const piano = piani[Math.min(n, piani.length - 1)];
      if (piano.finale) {
        try { onDelta && onDelta(piano.finale); } catch (_) {}
        return { ...base, text: piano.finale, toolCalls: [], finishReason: 'stop' };
      }
      const toolCalls = piano.strumenti.map((s, i) => ({ id: `c${n}_${i}`, name: s.nome, arguments: JSON.stringify(s.args || {}) }));
      for (const c of toolCalls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      return { ...base, text: '', toolCalls, finishReason: 'tool_calls' };
    };
  }, piani);
}

// La rete risponde, ma con la pagina che vede chi non ha fatto l'accesso: quella che l'utente ha davanti è un'altra.
async function reteDaFuori(app) {
  await app.evaluate(() => {
    globalThis.__scaricati = [];
    globalThis.SN_LETTURA_PAGINE._cache.clear();
    globalThis.SN_LETTURA_PAGINE._dip.scarica = async (url) => {
      globalThis.__scaricati.push(url);
      return new Response('<!doctype html><html><head><title>Accedi</title></head><body><main><h1>Accedi</h1>'
        + '<p>Per vedere le tue spedizioni accedi con il tuo account. Non hai un account? Registrati in un minuto.</p></main></body></html>',
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    };
  });
}

async function apriInSecondoPiano(app, url) {
  await app.evaluate((_e, url) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'NAVIGA', url, background: true }), url);
  await expect.poll(() => app.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows()
    .some((w) => w._filoTabs && w._filoTabs.tabs.some((t) => t.view.webContents.getURL() === url && !t.view.webContents.isLoading())), url),
  { timeout: 120_000 }).toBe(true);
}

const esitiDi = (app, giro) => app.evaluate((_e, giro) => (globalThis.__chiamate[giro] || [])
  .filter((m) => m.role === 'tool').map((m) => String(m.content || '')).join('\n'), giro);

test('r1 scheda letta in parte senza testo nella prima parte, rete con una copia diversa: il modello sa che la scheda continua', async ({ app, openTab, testServer }) => {
  test.setTimeout(240_000);
  const page = await openTab(NEWTAB);
  const url = testServer.html(`<!doctype html><html><head><title>Le mie spedizioni</title></head><body><main>${'<i></i>'.repeat(160000)}
<p>ULTIMA_RIGA consegnata il 27 settembre</p></main></body></html>`);
  await apriInSecondoPiano(app, url);
  await reteDaFuori(app);
  await stubModello(app, [{ strumenti: [{ nome: 'LEGGI_PAGINA', args: { url } }] }, { finale: 'RISPOSTA CINQUE' }]);
  await page.locator('#input').fill('quando è stata consegnata l\'ultima spedizione nella pagina che ho aperto?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA CINQUE' })).toBeVisible({ timeout: 120_000 });
  const letto = await esitiDi(app, 1);
  expect(await app.evaluate(() => globalThis.__scaricati.length)).toBe(1);
  expect(letto).toContain('Per vedere le tue spedizioni accedi');
  // Al modello deve arrivare che la scheda aperta ha altro oltre la parte letta, o che la copia può non essere quella dell'utente.
  expect(letto).toMatch(/prima parte|può non essere quello che vede l'utente/);
});
