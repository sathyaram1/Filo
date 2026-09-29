// Giro 16 (#590): esplorazione, seconda parte.
import { test, expect, lista, schede, contaAvvisi } from '../../helpers/reteFinta.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
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
  await app.evaluate(async (_electron, g) => {
    globalThis.__fake_calls = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__fake_calls.push(JSON.parse(JSON.stringify(messages)));
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

test('F1 doppio clic su Apri comunque', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), sito);
  const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).first();
  await expect(card).toBeVisible({ timeout: 6000 });
  await card.locator('.shell-notif-action', { hasText: 'Apri comunque' }).dblclick();
  await shell.waitForTimeout(2000);
  console.log('F1 schede su blocked.test dopo un doppio clic:', (await schede(app)).filter((u) => u.includes('blocked.test')).length);
});

test('F2 NAVIGA verso un accorciatore che rimanda con meta refresh', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const corto = rete.pagina('accorcia.test', '/m', `<meta http-equiv="refresh" content="0;url=${bersaglio}"><p>ti porto di là</p>`);
  const cortoJs = rete.pagina('accorcia.test', '/j', `<p>ti porto di là</p><script>location.replace(${JSON.stringify(bersaglio)})</script>`);
  const page = await newtabPage(app);
  const avvisi = await contaAvvisi(app);
  await modelloFinto(app, [
    { toolCalls: [
      { id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: corto, etichetta: 'corto' }) },
      { id: 'n2', name: 'NAVIGA', arguments: JSON.stringify({ url: cortoJs, etichetta: 'cortojs' }) },
    ] },
    { text: 'FINE-F2' },
  ]);
  await page.locator('#input').fill('apri quei link');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'FINE-F2' })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  const calls = await app.evaluate(() => globalThis.__fake_calls);
  const s = JSON.stringify(calls[1] || []);
  console.log('F2 al modello contiene «NON aperta»:', s.includes('NON aperta'), '| estratto:', (s.match(/"content":"[^"]{0,160}/g) || []).slice(-3));
  console.log('F2 schede:', await schede(app), 'avvisi:', await avvisi());
  const activity = page.locator('.dash-activity');
  if (await activity.count()) {
    await activity.first().locator('.dash-activity-head').click().catch(() => {});
    console.log('F2 diario:', await activity.first().innerText());
  }
  await page.screenshot({ path: 'tests/.shots/590-g16-f2-chat.png' });
});

test('F3 voce «.blocked.test» in Preferenze', async ({ app, shell, rete }) => {
  const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  await expect.poll(() => !!app.windows().find((w) => w.url().startsWith('filo://security')), { timeout: 8000 }).toBe(true);
  const pref = app.windows().find((w) => w.url().startsWith('filo://security'));
  await pref.waitForLoadState('domcontentloaded');
  const campo = pref.locator('#sec-siteblock-blacklist');
  await campo.scrollIntoViewIfNeeded();
  await campo.fill('.blocked.test');
  await campo.dispatchEvent('change');
  await pref.waitForTimeout(800);
  console.log('F3 avviso visibile:', await pref.locator('#sec-siteblock-blacklist-error').isVisible());
  const avvisi = await contaAvvisi(app);
  await shell.evaluate((u) => window.filoShell.tabs.open(u), sito);
  await shell.waitForTimeout(2500);
  console.log('F3 schede:', await schede(app), 'avvisi:', await avvisi());
});
