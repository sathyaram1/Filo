// Verifica #534 giro 2: i comandi che pagano, ordinano, disdicono o rispondono a un invito non devono partire,
// anche quando il nome non è in nessun elenco (rosso finché la regola guarda i nomi e non il gesto).
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

// Una cassa italiana, un abbonamento e l'invito a un evento dentro una mail: ogni pulsante qui spedisce, paga o disdice.
const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>Cassa e invito</title></head><body>
<button type="button" onclick="window.__clic.push('concludi')">Concludi ordine</button>
<div role="button" onclick="window.__clic.push('prenota')">Prenota ora</div>
<div role="button" onclick="window.__clic.push('rinnova')">Rinnova abbonamento</div>
<div role="button" onclick="window.__clic.push('riprova')">Riprova pagamento</div>
<div role="button" onclick="window.__clic.push('disdici')">Annulla abbonamento</div>
<div role="listitem"><p>Invito: Esame di fisica, giovedì 10:00</p><span>Partecipi?</span>
<div role="button" onclick="window.__clic.push('rsvp')">Sì</div></div>
<script>window.__clic = [];</script>
</body></html>`;

test('i pulsanti che pagano, ordinano, disdicono o rispondono a un invito non si premono', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const pagina = await testServer.openReady(openTab, PAGINA);
  await shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    await window.filoShell.tabs.activate(s.tabs.find((t) => t.url.startsWith('filo://newtab')).id);
  });
  const page = await home(app);
  const S = 'Cassa e invito';
  const nomi = ['Concludi ordine', 'Prenota ora', 'Rinnova abbonamento', 'Riprova pagamento', 'Annulla abbonamento', 'Sì'];
  await modello(app, [
    { toolCalls: nomi.map((e, k) => ({ id: `v${k}`, name: 'APRI_ELEMENTO', arguments: { scheda: S, elemento: e } })) },
    { text: 'Fatto.' },
  ]);
  await chiedi(page, 'concludi l\'ordine e rinnova');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 60_000 });
  expect(await pagina.evaluate(() => window.__clic)).toEqual([]);
});
