// Verifica #534 giro 3: un collegamento dello stesso sito che ordina o disdice, un nome che comincia come «mostra»,
// una scelta di un elenco: la forma dell'elemento non dice cosa fa il clic, e senza OK non deve partire niente.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, chiedi } from '../../helpers/chatFinta.mjs';

async function modello(app, giri) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await app.evaluate(async (_e, g) => {
    globalThis.__chiamate = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__chiamate.push({ messages: JSON.parse(JSON.stringify(messages)) });
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const calls = (giro.toolCalls || []).map((c) => ({ ...c, arguments: JSON.stringify(c.arguments || {}) }));
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>Cassa a link</title></head><body>
<a href="/carrello/concludi" data-method="post" onclick="window.__clic.push('link-concludi'); return false;">Concludi ordine</a>
<a href="/abbonamento/rinnova" class="btn" onclick="window.__clic.push('link-rinnova'); return false;">Rinnova abbonamento</a>
<a href="/abbonamento" data-turbo-method="delete" onclick="window.__clic.push('link-disdici'); return false;">Disdici</a>
<a href="#!" onclick="window.__clic.push('ancora-paga')">Completa e salda</a>
<div role="button" onclick="window.__clic.push('riduci')">Riduci il piano</div>
<button type="button" aria-haspopup="true" onclick="window.__clic.push('popup')">Ordina</button>
<div role="listbox" aria-label="Piano"><div role="option" onclick="window.__clic.push('option')">Piano Premium 19 €/mese</div></div>
<script>window.__clic = [];</script>
</body></html>`;

test('collegamenti, scelte e nomi che sembrano mostrare ma ordinano o disdicono non si premono senza OK', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const pagina = await testServer.openReady(openTab, PAGINA);
  await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    await window.filoShell.tabs.activate(s.tabs.find((t) => t.url.startsWith('filo://newtab')).id);
  });
  const page = await home(app);
  const S = 'Cassa a link';
  const nomi = ['Concludi ordine', 'Rinnova abbonamento', 'Disdici', 'Riduci il piano', 'Ordina', 'Piano Premium', 'Completa e salda'];
  await modello(app, [
    { toolCalls: nomi.map((e, k) => ({ id: `v${k}`, name: 'APRI_ELEMENTO', arguments: { scheda: S, elemento: e } })) },
    { text: 'Fatto.' },
  ]);
  await chiedi(page, 'concludi l\'ordine');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 60_000 });
  expect(await pagina.evaluate(() => window.__clic)).toEqual([]);
});
