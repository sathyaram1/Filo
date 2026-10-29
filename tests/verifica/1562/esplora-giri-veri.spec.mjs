// Esplorazione #1562 giro 2: il turno vero (handlers) con strumenti, un'azione secca e una lettura: ogni chiamata è il
// prefisso della dopo.

import { test, expect } from '../../fixtures/electron.mjs';

async function preparaModello(app, copione) {
  await app.evaluate(async (_e, copione) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
    });
    globalThis.__copione = copione.slice();
    globalThis.__chiamate = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, tools, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (!String((messages[0] && messages[0].content) || '').startsWith('Sei Filo, un assistente personale.')) {
        return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      }
      globalThis.__chiamate.push(JSON.parse(JSON.stringify({ messages, tools })));
      const r = globalThis.__copione.shift() || { text: 'ok' };
      n += 1;
      try { onDelta && r.text && onDelta(r.text); } catch (_) {}
      const reasoningDetails = [{ type: 'reasoning.text', text: `pensiero ${n}`, signature: `firma${n}`, format: 'anthropic-claude-v1', index: 0 }];
      return { ...base, text: r.text || '', toolCalls: r.toolCalls || [], reasoningDetails, finishReason: r.toolCalls ? 'tool_calls' : 'stop' };
    };
  }, copione);
}

async function apriHome(openTab) {
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  return home;
}

async function scrivi(home, testo, risposta) {
  await home.locator('#input').fill(testo);
  await home.locator('#sendBtn').click();
  if (risposta) await expect(home.locator('.dash-bubble-filo', { hasText: risposta })).toBeVisible({ timeout: 15_000 });
  await expect(home.locator('#sendBtn')).toBeVisible({ timeout: 15_000 });
}

function riscritto(prima, dopo) {
  return prima.findIndex((m, i) => JSON.stringify(m) !== JSON.stringify(dopo[i]));
}

test('esplora: lettura, azione secca, risposta: ogni chiamata è il prefisso della dopo', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  await preparaModello(app, [
    { text: '', toolCalls: [{ id: 'l1', name: 'LEGGI_IMPOSTAZIONI', arguments: '{"cerca":"tema"}' }] },
    { text: 'Il tema è chiaro.' },
    { text: 'Avviato.', toolCalls: [{ id: 't1', name: 'TIMER', arguments: '{"secondi":600,"etichetta":"pasta"}' }] },
    { text: 'Prego!' },
    { text: 'Va bene.' },
  ]);
  const home = await apriHome(openTab);
  await scrivi(home, 'che tema ho?', 'Il tema è chiaro.');
  await scrivi(home, 'metti un timer di 10 minuti per la pasta', null);
  await expect.poll(() => app.evaluate(() => globalThis.__chiamate.length)).toBe(3);
  await scrivi(home, 'grazie', 'Prego!');
  await scrivi(home, 'ok', 'Va bene.');
  const chiamate = await app.evaluate(() => globalThis.__chiamate);
  const rotture = [];
  for (let i = 1; i < chiamate.length; i++) {
    const k = riscritto(chiamate[i - 1].messages, chiamate[i].messages);
    if (k !== -1) rotture.push({ chiamata: i, posto: k, prima: JSON.stringify(chiamate[i - 1].messages[k]).slice(0, 400), dopo: JSON.stringify(chiamate[i].messages[k]).slice(0, 400) });
  }
  console.log(JSON.stringify(rotture, null, 1));
  console.log(JSON.stringify(chiamate.at(-1).messages.slice(1).map((m) => ({ r: m.role, c: JSON.stringify(m.content).slice(0, 160), rd: !!m.reasoning_details, tc: !!m.tool_calls }))), null, 1));
  expect(rotture).toEqual([]);
});
