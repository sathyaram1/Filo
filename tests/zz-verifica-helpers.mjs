// Aiuti condivisi della verifica (temporaneo).
export async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

export async function configureModel(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

// Copione: un array di giri. Ogni giro: { text, toolCalls, reasoningDetails, fail, delayMs }.
// Registra in globalThis.__verCalls cosa ha ricevuto il provider a ogni chiamata.
export async function installScript(app, script) {
  await app.evaluate(async (_electron, script) => {
    globalThis.__verScript = script;
    globalThis.__verCalls = [];
    globalThis.__verIdx = 0;
    if (!globalThis.__verOrig) globalThis.__verOrig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__verErr = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, tools, toolChoice, onDelta, onReasoning, onToolCall }) => {
     try {
      const i = globalThis.__verIdx++;
      const step = globalThis.__verScript[Math.min(i, globalThis.__verScript.length - 1)] || {};
      globalThis.__verCalls.push({
        i,
        toolsNames: Array.isArray(tools) ? tools.map((t) => t.function && t.function.name) : null,
        toolChoice,
        messages: JSON.parse(JSON.stringify(messages)),
      });
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      if (step.reasoningDetails) {
        for (const d of step.reasoningDetails) { try { onReasoning && onReasoning(d.text || ''); } catch (_) {} }
      }
      if (step.toolCalls) {
        for (const c of step.toolCalls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      }
      if (step.text) {
        const parts = step.text.match(/.{1,12}/gs) || [];
        for (const p of parts) { try { onDelta && onDelta(p); } catch (_) {} await wait(5); }
      }
      if (step.delayMs) await wait(step.delayMs);
      if (step.fail) throw new Error(step.fail);
      return {
        text: step.text || '',
        toolCalls: step.toolCalls || [],
        reasoningDetails: step.reasoningDetails || [],
        finishReason: step.toolCalls && step.toolCalls.length ? 'tool_calls' : 'stop',
        model: attempts[0].model, provider: attempts[0].provider, servedBy: 'test-host',
        usage: { promptTokens: 100, completionTokens: 20 },
      };
     } catch (e) { globalThis.__verErr.push(String(e && e.stack || e)); throw e; }
    };
    globalThis.SN_WEB_SEARCH.search = async ({ query }) => ({
      ok: true, provider: 'test', results: [
        { title: 'Risultato uno per ' + query, url: 'https://example.com/uno', snippet: 'Snippet UNO-MARK' },
        { title: 'Risultato due', url: 'https://example.com/due', snippet: 'Snippet DUE-MARK' },
      ],
    });
  }, script);
}

export async function dumpChat(page) {
  return page.evaluate(() => {
    const q = (s, r = document) => Array.from(r.querySelectorAll(s));
    const txt = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null);
    return {
      bubbles: q('.dash-bubble-filo').map((b) => {
        const c = b.cloneNode(true);
        c.querySelectorAll('.dash-bubble-actions,.dash-activity').forEach((n) => n.remove());
        return txt(c);
      }),
      streaming: q('.dash-bubble-streaming').length,
      activities: q('.dash-activity').map((a) => ({
        cls: a.className,
        open: a.open, // se è un <details>
        head: txt(a.querySelector('.dash-activity-head')),
        rows: q('.dash-activity-row', a).map(txt),
        notes: q('.dash-activity-note', a).map(txt),
        reasoning: q('.dash-activity-reasoning', a).map(txt),
        cmds: q('.dash-activity-cmd', a).map(txt),
        html: a.outerHTML.slice(0, 1500),
      })),
      actions: q('.dash-bubble-actions .dash-action-btn').map(txt),
    };
  });
}

