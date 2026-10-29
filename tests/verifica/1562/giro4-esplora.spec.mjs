// Esplorazione del giro 4: una giornata normale fra due chat, con un timer, una pagina aperta e il ritorno.

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
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, tools, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (!String((messages[0] && messages[0].content) || '').startsWith('Sei Filo, un assistente personale.')) {
        return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      }
      globalThis.__chiamate.push(JSON.parse(JSON.stringify({ messages, tools })));
      const r = globalThis.__copione.shift() || { text: 'ok' };
      if (r.toolCalls) return { ...base, text: r.text || '', toolCalls: r.toolCalls, reasoningDetails: [{ type: 'reasoning.text', text: 'p', signature: 's', format: 'anthropic-claude-v1', index: 0 }], finishReason: 'tool_calls' };
      try { onDelta && onDelta(r.text); } catch (_) {}
      return { ...base, text: r.text, toolCalls: [], reasoningDetails: [{ type: 'reasoning.text', text: `r-${r.text}`, signature: 's', format: 'anthropic-claude-v1', index: 0 }], finishReason: 'stop' };
    };
  }, copione);
}

async function apriHome(openTab) {
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  return home;
}

async function scrivi(home, testo, risposta) {
  await home.bringToFront();
  await home.locator('#input').fill(testo);
  await home.locator('#sendBtn').click();
  await expect(home.locator('.dash-bubble-filo', { hasText: risposta })).toBeVisible({ timeout: 20_000 });
  await expect(home.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
}

const testo = (m) => (typeof m.content === 'string' ? m.content : (m.content || []).map((p) => p.text || '').join(''));

function primaDifferenza(prima, dopo) {
  for (let i = 0; i < prima.length; i++) {
    if (JSON.stringify(prima[i]) !== JSON.stringify(dopo[i])) return i;
  }
  return -1;
}

test('giornata in due chat: ogni turno è il prefisso del turno dopo', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  await preparaModello(app, [
    { text: 'Ciao!' },
    { toolCalls: [{ id: 't1', name: 'TIMER', arguments: JSON.stringify({ secondi: 3, etichetta: 'tè' }) }] },
    { text: 'Timer messo.' },
    { text: 'Ha suonato il tè.' },
    { text: 'Ciao da B.' },
    { text: 'Eccomi A.' },
    { text: 'Ultima.' },
  ]);
  const a = await apriHome(openTab);
  await scrivi(a, 'ciao', 'Ciao!');
  await scrivi(a, 'timer di 3 secondi per il tè', 'Timer messo.');
  await a.waitForTimeout(6000);
  const pagina = await openTab(testServer.html('<title>Ricetta lasagne</title><h1>Lasagne</h1>'));
  await pagina.waitForTimeout(1500);
  await scrivi(a, 'che succede?', 'Ha suonato il tè.');
  const b = await apriHome(openTab);
  await scrivi(b, 'ciao da B', 'Ciao da B.');
  await scrivi(a, 'e ora?', 'Eccomi A.');
  await scrivi(a, 'ultima', 'Ultima.');

  const chiamate = await app.evaluate(() => globalThis.__chiamate);
  const righe = [];
  for (let k = 1; k < chiamate.length; k++) {
    const p = chiamate[k - 1].messages;
    const d = chiamate[k].messages;
    const i = primaDifferenza(p, d);
    righe.push(`chiamata ${k} -> ${k + 1}: lunghezze ${p.length}/${d.length}, prima differenza ${i}`);
    if (i >= 0) {
      righe.push(`  PRIMA: ${JSON.stringify(p[i]).slice(0, 1500)}`);
      righe.push(`  DOPO:  ${JSON.stringify(d[i]).slice(0, 1500)}`);
    }
    righe.push(`  tools uguali: ${JSON.stringify(chiamate[k].tools) === JSON.stringify(chiamate[0].tools)}`);
  }
  righe.push('--- ultima domanda di ogni chiamata ---');
  for (const c of chiamate) righe.push(JSON.stringify(testo(c.messages.at(-1))).slice(0, 1200));
  console.log(righe.join('\n'));
  expect(righe.filter((r) => /prima differenza (?!-1)/.test(r))).toEqual([]);
});
