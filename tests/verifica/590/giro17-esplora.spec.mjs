// Esplorazione del giro 17 (#590): barra di una scheda web, modulo inviato, pagina «Sito bloccato» nei due temi,
// NAVIGA bloccata e cosa resta in chat quando la notifica se n'è andata.
import { test, expect, lista, schede, apri, idAttiva, contaAvvisi, schedaSu } from '../../helpers/reteFinta.mjs';

const PAGINA_BLOCCATA = /^filo:\/\/error\/error\.html\?.*code=blocked/;

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
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__fake_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__fake_calls = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__fake_calls.push(JSON.parse(JSON.stringify(messages)));
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      if (giro.ritardoMs) await new Promise((r) => setTimeout(r, giro.ritardoMs));
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

test('E1 barra di una scheda web verso un sito della lista', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const avvisi = await contaAvvisi(app);
  const pagina = rete.pagina('sito.test', '/', '<h1>qui</h1>');
  const bersaglio = rete.pagina('blocked.test', '/x', '<h1>SITO DELLA LISTA</h1>');
  await apri(app, shell, pagina);
  const id = await idAttiva(app);
  await shell.evaluate(([i, u]) => window.filoShell.tabs.navigate(i, u), [id, bersaglio]);
  await shell.waitForTimeout(2000);
  console.log('E1 schede', JSON.stringify(await schede(app)), 'avvisi', JSON.stringify(await avvisi()));
  await shell.evaluate(([i, u]) => window.filoShell.tabs.navigate(i, u), [id, 'blocked.test/y']);
  await shell.waitForTimeout(2000);
  console.log('E1b schede', JSON.stringify(await schede(app)), 'avvisi', JSON.stringify(await avvisi()));
});

test('E6 modulo inviato verso il sito della lista, e history.back della pagina', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const avvisi = await contaAvvisi(app);
  rete.pagina('blocked.test', '/post', '<h1>SITO DELLA LISTA</h1>');
  const pagina = rete.pagina('sito.test', '/', '<form id="f" method="post" action="http://blocked.test/post"><input name="a" value="1"></form>');
  await apri(app, shell, pagina);
  const tab = app.windows().find((w) => w.url().includes('sito.test'));
  await tab.evaluate(() => document.getElementById('f').submit());
  await shell.waitForTimeout(2500);
  console.log('E6 schede', JSON.stringify(await schede(app)), 'avvisi', JSON.stringify(await avvisi()));
});

for (const tema of ['light', 'dark']) {
  test(`E2 pagina «Sito bloccato» in tema ${tema}`, async ({ app, shell, rete }) => {
    await app.evaluate(async (_e, t) => { await globalThis.SN_STORAGE.updateSettings({ theme: t }); }, tema);
    await lista(shell, []);
    const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
    await apri(app, shell, sito);
    await lista(shell, ['blocked.test']);
    await expect.poll(() => (schedaSu(app, 'blocked.test').then((s) => (s || {}).caricata || '')), { timeout: 6000 }).toMatch(PAGINA_BLOCCATA);
    const win = app.windows().find((w) => PAGINA_BLOCCATA.test(w.url()));
    await win.waitForTimeout(800);
    await win.screenshot({ path: `tests/.shots/590-g17-bloccata-${tema}.png` });
    await shell.screenshot({ path: `tests/.shots/590-g17-shell-${tema}.png` });
  });
}

test('E3 NAVIGA bloccata: dopo che la notifica se ne va, cosa resta in chat', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8000 });
  await modelloFinto(app, [
    { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: bersaglio, etichetta: 'pagina' }) }] },
    { ritardoMs: 3000, text: 'Non l’ho aperta: è fra i siti che hai bloccato. Se vuoi aprirla lo stesso c’è «Apri comunque» nella notifica.' },
  ]);
  await page.locator('#input').fill('apri quella pagina');
  await page.locator('#sendBtn').click();
  const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' });
  await expect(card.first()).toBeVisible({ timeout: 6000 });
  const t0 = Date.now();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Non l’ho aperta' })).toBeVisible({ timeout: 15_000 });
  console.log('E3 risposta dopo ms', Date.now() - t0, 'notifica visibile', await card.count());
  await page.waitForTimeout(3000);
  console.log('E3 dopo 3s notifica', await card.count());
  await page.screenshot({ path: 'tests/.shots/590-g17-chat.png' });
  const act = page.locator('.dash-activity');
  if (await act.count()) {
    await act.first().locator('.dash-activity-head').click().catch(() => {});
    await page.waitForTimeout(300);
    console.log('E3 attività', await act.first().innerText());
    console.log('E3 link in attività', await act.first().locator('a, button').evaluateAll((els) => els.map((e) => `${e.tagName}:${e.textContent.trim()}:${e.getAttribute('href') || ''}`)));
  }
  await page.screenshot({ path: 'tests/.shots/590-g17-chat-aperta.png' });
  await app.evaluate(() => { try { globalThis.__fake_restore?.(); } catch (_) {} });
});

test('E7 tre NAVIGA in un giro: quando nasce ogni scheda', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const urls = ['/a', '/b', '/c'].map((p) => rete.pagina('libero.test', p, `<h1>${p}</h1><img src="/lenta.png">`, { ritardoMs: 800 }));
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8000 });
  await modelloFinto(app, [
    { toolCalls: urls.map((u, i) => ({ id: `n${i}`, name: 'NAVIGA', arguments: JSON.stringify({ url: u, etichetta: `p${i}`, background: true }) })) },
    { text: 'Aperte.' },
  ]);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    globalThis.__nascite = [];
    const orig = w._filoTabs.openTab.bind(w._filoTabs);
    w._filoTabs.openTab = (u, o) => { globalThis.__nascite.push([Date.now(), String(u)]); return orig(u, o); };
  });
  const t0 = await app.evaluate(() => Date.now());
  await page.locator('#input').fill('apri le tre pagine');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Aperte' })).toBeVisible({ timeout: 30_000 });
  const t1 = await app.evaluate(() => Date.now());
  const nascite = await app.evaluate(() => globalThis.__nascite);
  console.log('E7 nascite (ms da invio)', JSON.stringify(nascite.map(([t, u]) => [t - t0, u.replace(/^http:\/\/[^/]+/, '')])), 'risposta a', t1 - t0);
  await app.evaluate(() => { try { globalThis.__fake_restore?.(); } catch (_) {} });
});

for (const attesa of [1, 3]) {
  test(`E8 NAVIGA verso una pagina che rimanda al sito della lista dopo ${attesa} s`, async ({ app, shell, rete }) => {
    test.setTimeout(60_000);
    await lista(shell, ['blocked.test']);
    const avvisi = await contaAvvisi(app);
    const bersaglio = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
    const ponte = rete.pagina('accorcia.test', '/p', `<meta http-equiv="refresh" content="${attesa};url=${bersaglio}"><h1>Stai lasciando il sito…</h1>`);
    const page = await newtabPage(app);
    await expect(page.locator('#input')).toBeVisible({ timeout: 8000 });
    await modelloFinto(app, [
      { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: ponte, etichetta: 'pagina' }) }] },
      { text: 'Fatto.' },
    ]);
    await page.locator('#input').fill('apri quel link');
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto' })).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout((attesa + 2) * 1000);
    const calls = await app.evaluate(() => globalThis.__fake_calls);
    const secondo = JSON.stringify(calls[1] || []);
    console.log(`E8 ${attesa}s avvisi`, JSON.stringify(await avvisi()), 'schede', JSON.stringify(await schede(app)));
    console.log(`E8 ${attesa}s al modello:`, (secondo.match(/(Pagina NON aperta[^"]{0,80}|Eseguit[^"]{0,60})/) || ['?'])[0]);
    const act = page.locator('.dash-activity').first();
    if (await act.count()) { await act.locator('.dash-activity-head').click().catch(() => {}); await page.waitForTimeout(300); console.log(`E8 ${attesa}s diario:`, (await act.innerText()).replace(/\n/g, ' | ')); }
    await app.evaluate(() => { try { globalThis.__fake_restore?.(); } catch (_) {} });
  });
}
