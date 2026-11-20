// #504 giro 1, rilievo 1 — con la pagina davanti, «traducimi questa pagina» scritto nell'Aiuto (il pannello per
// chiedere a Filo sulla pagina) deve tradurla come l'icona. Il modello finto usa la strada che le istruzioni
// dell'Aiuto gli offrono per tradurre la pagina; se non ne offrono nessuna risponde a parole, come farebbe uno vero.

import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';

const ARTICLE = `<!doctype html><html lang="en"><head><title>Football era</title></head><body style="font:16px sans-serif;padding:20px">
  <h1 id="title">The end of an era in European football</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up.</p>
</body></html>`;

async function modelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash', [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__sistemaAiuto = '';
    const risposta = async ({ attempts, messages }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
      const last = [...messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.includes('@@@SN_SEP@@@')) {
        const APRE = '<<<TESTO_IN_PAGINA>>>\n';
        const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
        const i = prompt.indexOf(APRE);
        const fine = prompt.lastIndexOf(CHIUDE);
        const chunk = i >= 0 && fine > i ? prompt.slice(i + APRE.length, fine) : '';
        return { ...base, text: chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join('\n@@@SN_SEP@@@\n') };
      }
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      if (!sistema.includes('# Protocollo di risposta')) return { ...base, text: '{}' };
      globalThis.__sistemaAiuto = sistema;
      if (sistema.includes('TRADUCI_PAGINA')) {
        return { ...base, text: JSON.stringify({ action: 'filo', filo: { type: 'TRADUCI_PAGINA' }, text: 'Traduco la pagina.', status: 'done' }) };
      }
      const op = (sistema.match(/"(\w*(?:transl|tradu)\w*)"/i) || [])[1];
      if (op) return { ...base, text: JSON.stringify({ action: 'page', page: { op }, text: 'Traduco la pagina.', status: 'done' }) };
      return { ...base, text: JSON.stringify({ text: 'Per tradurla usa l\'icona Traduci della barra laterale.', status: 'done' }) };
    };
    P.completeWithFallback = risposta;
    P.streamCompleteWithFallback = risposta;
  });
}

test('r1 nell\'Aiuto della pagina «traducimi questa pagina» traduce la pagina', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelli(app);
  const page = await testServer.openReady(openTab, ARTICLE);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, page);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await aiuto.fill('.sn-sidebar-input textarea', 'traducimi questa pagina');
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
  await expect.poll(() => app.evaluate(() => globalThis.__sistemaAiuto.length), { timeout: 20_000 }).toBeGreaterThan(0);

  await expect(page.locator('#title')).toHaveText(/^IT /, { timeout: 20_000 });
  await expect(page.locator('#p1')).toHaveText(/^IT /);
  await expect(aiuto.locator('.sn-sidebar')).not.toContainText('non riuscita');
  await aiuto.screenshot({ path: 'tests/.shots/v504-r1-aiuto.png' });
});
