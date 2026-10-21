// Esplorazione della verifica #1552: la chat della home su Claude, col router finto nel main.
import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function prepara(app, modello) {
  await app.evaluate(async (_e, modello) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: modello },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__corpi = [];
    globalThis.__piano = [];
    const orig = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const u = String(url && url.url ? url.url : url);
      if (!u.includes('/chat/completions')) return new Response('{"error":"no"}', { status: 404, headers: { 'content-type': 'application/json' } });
      const corpo = JSON.parse(opts.body);
      const n = globalThis.__corpi.push(corpo);
      const passo = globalThis.__piano.shift() || { testo: `Risposta ${n}.` };
      const enc = new TextEncoder();
      const righe = [];
      righe.push({ id: `gen-${n}`, choices: [{ delta: { reasoning: `pensiero ${n}`, reasoning_details: [{ type: 'reasoning.text', text: `pensiero ${n}`, signature: `firma-${n}`, format: 'anthropic-claude-v1', index: 0 }] } }] });
      if (passo.strumento) righe.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${n}`, type: 'function', function: { name: passo.strumento, arguments: JSON.stringify(passo.args || {}) } }] } }] });
      else righe.push({ choices: [{ delta: { content: passo.testo } }] });
      righe.push({ choices: [{ delta: {}, finish_reason: passo.strumento ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 }, provider: 'Anthropic' });
      const testo = righe.map((r) => `data: ${JSON.stringify(r)}\n\n`).join('') + 'data: [DONE]\n\n';
      return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(testo)); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    globalThis.__ripristina = () => { globalThis.fetch = orig; };
  }, modello);
}

async function manda(page, app, testo, attese) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
  await expect.poll(() => app.evaluate(() => globalThis.__corpi.length), { timeout: 30_000 }).toBe(attese);
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

const senzaPunti = (m) => {
  const c = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content || []).map(({ cache_control: _x, ...r }) => r);
  return JSON.stringify([m.role, c, m.tool_calls || null, m.tool_call_id || null, m.reasoning_details || null]);
};

for (const modello of ['claude', 'deepseek-flash']) {
  test(`esplora ${modello}`, async ({ app, shell }) => {
    test.setTimeout(120_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await expect(page.locator('#input')).toBeVisible();
    await prepara(app, modello);
    await manda(page, app, 'ciao, come va?', 1);
    await app.evaluate(() => { globalThis.__piano.push({ strumento: 'TIMER', args: { minutes: 5, label: 'Pasta' } }, { testo: 'Timer messo.' }); });
    await manda(page, app, 'metti un timer di 5 minuti per la pasta', 3);
    await manda(page, app, 'grazie mille', 4);
    const corpi = await app.evaluate(() => globalThis.__corpi);
    const tutto = JSON.stringify(corpi);
    const report = corpi.map((c, i) => ({ i, msgs: c.messages.map((m) => `${m.role}${m.tool_calls ? '+tc' : ''}${m.reasoning_details ? '+RD' : ''}`).join(' ') }));
    console.log(modello, JSON.stringify(report, null, 1));
    expect(tutto).not.toContain('filo.impronta');
    // Ogni ragionamento che parte deve avere davanti esattamente il prefisso della richiesta in cui è nato.
    for (let k = 1; k < corpi.length; k++) {
      corpi[k].messages.forEach((m, j) => {
        if (!m.reasoning_details) return;
        const sig = m.reasoning_details[0].signature;
        const nato = Number(sig.split('-')[1]) - 1;
        const prima = corpi[nato].messages.map(senzaPunti);
        const adesso = corpi[k].messages.slice(0, j).map(senzaPunti);
        console.log(modello, `corpo ${k} msg ${j} nato in ${nato}: prefisso uguale=${JSON.stringify(prima) === JSON.stringify(adesso)} strumenti uguali=${JSON.stringify(corpi[nato].tools) === JSON.stringify(corpi[k].tools)}`);
        if (modello === 'claude') {
          expect(JSON.stringify(adesso)).toBe(JSON.stringify(prima));
          expect(JSON.stringify(corpi[k].tools)).toBe(JSON.stringify(corpi[nato].tools));
        }
      });
    }
    if (modello === 'claude') {
      const m = corpi[2].messages;
      const a = m.findLast((x) => x.role === 'assistant' && x.tool_calls);
      expect(a && a.reasoning_details, 'nel giro di strumenti il ragionamento dell\'ultimo messaggio dell\'assistente manca').toBeTruthy();
    } else {
      expect(corpi[3].messages.some((x) => x.role === 'assistant' && x.reasoning_details)).toBe(true);
    }
    await app.evaluate(() => globalThis.__ripristina());
  });
}
