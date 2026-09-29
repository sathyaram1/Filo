// Verifica #590 giro 16, rilievo 3: un sito fermato dalle liste di pubblicità e tracciamento non va
// raccontato come un divieto scritto dall'utente, né al modello né nella notifica.
import { test, expect, lista } from '../../helpers/reteFinta.mjs';

// Ogni notifica mandata alla shell, qualunque sia la sua forma.
async function notifiche(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    globalThis.__g16_toast = [];
    const orig = w.webContents.send.bind(w.webContents);
    w.webContents.send = (ch, ...a) => {
      if (ch === 'shell:toast' && a[0]) globalThis.__g16_toast.push(String(a[0].text || ''));
      return orig(ch, ...a);
    };
  });
  return () => app.evaluate(() => globalThis.__g16_toast.slice());
}

async function home(app) {
  const fine = Date.now() + 10_000;
  while (Date.now() < fine) {
    const w = app.windows().find((x) => x.url().startsWith('filo://newtab'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

async function modelloFinto(app, giri) {
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
    globalThis.__g16_calls = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__g16_calls.push(JSON.parse(JSON.stringify(messages)));
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [],
        finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}

test('NAVIGA verso un sito delle liste pubbliche: il modello e la notifica non lo chiamano un divieto dell\'utente', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await app.evaluate(() => { globalThis.__filoAdblock.setDomainsForTest(['tracker.test']); });
  await lista(shell, [], { useAdblockLists: true });
  const tracker = rete.pagina('tracker.test', '/x', '<h1>T</h1>');
  const page = await home(app);
  const avvisi = await notifiche(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: tracker, etichetta: 'pagina' }) }] },
    { text: 'RISPOSTA-G16' },
  ]);
  await page.locator('#input').fill('apri quella pagina');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA-G16' })).toBeVisible({ timeout: 10_000 });

  // Solo le risposte agli strumenti: il resto del contesto (istruzioni di sistema) non conta.
  const alModello = JSON.stringify(((await app.evaluate(() => globalThis.__g16_calls))[1] || [])
    .filter((m) => m && m.role === 'tool').map((m) => m.content));
  expect(alModello).toContain('NON aperta');
  expect(alModello, 'la lista dell\'utente è vuota: il modello non deve dirgli che quel sito ce l\'ha messo lui')
    .toMatch(/pubblicit|traccia/i);
  const dette = (await avvisi()).filter((t) => t.includes('tracker.test')).join('\n');
  expect(dette).toContain('tracker.test');
  expect(dette, 'la notifica deve distinguersi dal divieto scritto dall\'utente, come fa la pagina «Sito bloccato»')
    .toMatch(/pubblicit|traccia/i);
});
