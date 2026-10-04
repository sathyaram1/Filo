// Verifica #534 giro 1: i comandi che inviano o pagano con nomi italiani comuni non devono partire.
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
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
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

// Gmail in italiano: il pulsante accanto a Invia apre «Programma invio», e una scelta del riquadro spedisce.
// Un negozio e una banca con pulsanti che pagano, senza modulo intorno (come nelle pagine fatte di soli div).
const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>Pagine che spediscono</title></head><body>
<div role="button" id="altre" onclick="document.getElementById('menu').hidden=false">Altre opzioni di invio</div>
<div role="menu" id="menu" hidden><div role="menuitem" onclick="document.getElementById('prog').hidden=false">Programma invio</div></div>
<div role="dialog" id="prog" hidden><div role="menuitem" onclick="window.__spedito=(window.__spedito||0)+1">Domani mattina, 5 ott, 8:00</div></div>
<div role="button" onclick="window.__ordine=1">Conferma ordine</div>
<div role="button" onclick="window.__bonifico=1">Esegui bonifico</div>
<div role="button" onclick="window.__autorizzato=1">Autorizza pagamento</div>
</body></html>`;

test('i pulsanti che spediscono o pagano con nomi italiani comuni non si premono', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const pagina = await testServer.openReady(openTab, PAGINA);
  await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    await window.filoShell.tabs.activate(s.tabs.find((t) => t.url.startsWith('filo://newtab')).id);
  });
  const page = await home(app);
  const S = 'Pagine che spediscono';
  await modello(app, [
    { toolCalls: [{ id: 'a1', name: 'APRI_ELEMENTO', arguments: { scheda: S, elemento: 'Altre opzioni di invio' } }] },
    { toolCalls: [{ id: 'a2', name: 'APRI_ELEMENTO', arguments: { scheda: S, elemento: 'Programma invio' } }] },
    { toolCalls: [{ id: 'a3', name: 'APRI_ELEMENTO', arguments: { scheda: S, elemento: 'Domani mattina' } }] },
    {
      toolCalls: [
        { id: 'a4', name: 'APRI_ELEMENTO', arguments: { scheda: S, elemento: 'Conferma ordine' } },
        { id: 'a5', name: 'APRI_ELEMENTO', arguments: { scheda: S, elemento: 'Esegui bonifico' } },
        { id: 'a6', name: 'APRI_ELEMENTO', arguments: { scheda: S, elemento: 'Autorizza pagamento' } },
      ],
    },
    { text: 'Fatto.' },
  ]);
  await chiedi(page, 'programma la mail per domani e paga');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 60_000 });
  const esito = await pagina.evaluate(() => ({
    spedito: window.__spedito || 0, ordine: window.__ordine || 0, bonifico: window.__bonifico || 0, autorizzato: window.__autorizzato || 0,
  }));
  expect(esito).toEqual({ spedito: 0, ordine: 0, bonifico: 0, autorizzato: 0 });
});
