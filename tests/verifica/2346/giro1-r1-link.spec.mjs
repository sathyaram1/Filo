// Verifica #2346 giro 1, rilievo 1: un passo selezionato che attraversa un link della risposta si cita monco, con la
// parentesi del link dentro, e un clic sulla citazione non ritrova il passo intero. Il modello è finto.

import { test, expect } from '../../fixtures/electron.mjs';

const RISPOSTA = 'Ne parla la [guida ufficiale](https://example.com/guida/selezione) e poi anche il forum.';
const PASSO = 'la guida ufficiale e poi';

test('r1 un passo che attraversa un link si cita intero, arriva intero a Filo e un clic lo riseleziona intero', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await app.evaluate(async (_e, testi) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__testi = testi.slice();
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const chat = !!messages[0] && messages[0].role === 'system' && String(messages[0].content || '').startsWith(globalThis.SN_CONST.PROMPTS.filoChatStatic());
      if (!chat) return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      globalThis.__chiamate.push(JSON.parse(JSON.stringify(messages)));
      const t = globalThis.__testi.shift() || 'ok';
      try { onDelta && onDelta(t); } catch (_) {}
      return { ...base, text: t, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, [RISPOSTA, 'Letto.']);
  const home = await openTab('filo://newtab/');
  const input = home.locator('#input');
  await expect(input).toBeEditable({ timeout: 15_000 });
  await input.fill('dove lo leggo?');
  await input.press('Enter');
  const risposta = home.locator('#bubbles > .dash-bubble-filo', { hasText: 'forum' });
  await expect(risposta).toHaveAttribute('data-key', /^m:/, { timeout: 20_000 });

  // Il mouse seleziona «la guida ufficiale e poi»: dentro c'è il link.
  await risposta.evaluate((el, cosa) => {
    const nodi = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let x = w.nextNode(); x; x = w.nextNode()) nodi.push(x);
    const tutto = nodi.map((x) => x.data).join('');
    const k = tutto.indexOf(cosa);
    const dove = (p) => { let f = 0; for (const x of nodi) { if (p <= f + x.data.length) return [x, p - f]; f += x.data.length; } return null; };
    const r = document.createRange();
    r.setStart(...dove(k)); r.setEnd(...dove(k + cosa.length));
    getSelection().removeAllRanges(); getSelection().addRange(r);
  }, PASSO);
  await risposta.hover();
  await risposta.getByRole('button', { name: 'Rispondi' }).click();
  await expect(home.locator('#citazione .dash-citazione-testo')).toHaveText(PASSO);

  await input.fill('quale guida?');
  await input.press('Enter');
  const mia = home.locator('#bubbles > .dash-bubble-user', { hasText: 'quale guida?' });
  await expect(mia.locator('.dash-citata')).toHaveAttribute('data-testo', PASSO, { timeout: 10_000 });
  await expect(home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Letto.' })).toBeVisible({ timeout: 20_000 });
  const detta = await app.evaluate(() => {
    const msgs = globalThis.__chiamate[globalThis.__chiamate.length - 1];
    const m = msgs[msgs.length - 1];
    return typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  });
  expect(detta).toMatch(/«(la guida ufficiale e poi|la \[guida ufficiale\]\(https:\/\/example\.com\/guida\/selezione\) e poi)»/);

  await home.evaluate(() => getSelection().removeAllRanges());
  await mia.locator('.dash-citata').click();
  await expect.poll(() => home.evaluate(() => getSelection().toString())).toBe(PASSO);
});
