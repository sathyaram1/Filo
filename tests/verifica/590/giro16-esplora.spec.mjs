// Giro 16 (#590): esplorazione. Rete finta: tests/helpers/reteFinta.mjs.
import { test, expect, lista, schede, apri, contaAvvisi, schedaSu } from '../../helpers/reteFinta.mjs';

const PAGINA_BLOCCATA = /^filo:\/\/error\/error\.html\?.*code=blocked/;
const aperteSu = async (app, host) => (await schede(app)).filter((u) => u.includes(host));

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
    globalThis.__fake_t = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__fake_calls.push(JSON.parse(JSON.stringify(messages)));
      globalThis.__fake_t.push(Date.now());
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

test('E1 Apri comunque premuto tre volte', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), sito);
  const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).first();
  await expect(card).toBeVisible({ timeout: 6000 });
  const btn = card.locator('.shell-notif-action', { hasText: 'Apri comunque' });
  await btn.click({ clickCount: 3 }).catch(() => {});
  await shell.waitForTimeout(2000);
  console.log('E1 schede su blocked.test:', (await aperteSu(app, 'blocked.test')).length);
});

test('E2 NAVIGA verso un tracciatore delle liste pubbliche: cosa sente il modello', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await app.evaluate(() => { globalThis.__filoAdblock.setDomainsForTest(['tracker.test']); });
  await lista(shell, [], { useAdblockLists: true });
  const t = rete.pagina('tracker.test', '/x', '<h1>T</h1>');
  const page = await newtabPage(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: t, etichetta: 'pagina' }) }] },
    { text: 'FINE-E2' },
  ]);
  await page.locator('#input').fill('apri quella pagina');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'FINE-E2' })).toBeVisible({ timeout: 10_000 });
  const calls = await app.evaluate(() => globalThis.__fake_calls);
  const s = JSON.stringify(calls[1] || []);
  const m = s.match(/Pagina NON aperta[^"]*/);
  console.log('E2 al modello:', m && m[0]);
  const activity = page.locator('.dash-activity');
  await activity.locator('.dash-activity-head').click();
  console.log('E2 diario:', await activity.innerText());
});

test('E3 NAVIGA verso una pagina lenta: quanto aspetta la chat', async ({ app, shell, rete }) => {
  test.setTimeout(60_000);
  await lista(shell, ['blocked.test']);
  const lenta = rete.pagina('sito.test', '/lenta', '<h1>LENTA</h1>', { ritardoMs: 4000 });
  const page = await newtabPage(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: lenta, etichetta: 'lenta' }) }] },
    { text: 'FINE-E3' },
  ]);
  await page.locator('#input').fill('apri quella pagina');
  const t0 = Date.now();
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'FINE-E3' })).toBeVisible({ timeout: 15_000 });
  const ts = await app.evaluate(() => globalThis.__fake_t);
  console.log('E3 tra la tool call e il secondo giro (ms):', ts[1] - ts[0], 'totale', Date.now() - t0);
});

for (const tema of ['light', 'dark']) {
  test(`E4 pagina Sito bloccato, tema ${tema}`, async ({ app, shell, rete }) => {
    await shell.evaluate((t) => window.filoShell.message({ type: 'update_settings', settings: { theme: t } }), tema);
    await lista(shell, []);
    const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
    await apri(app, shell, sito);
    await lista(shell, ['blocked.test']);
    await expect.poll(async () => ((await schedaSu(app, 'blocked.test')) || {}).caricata || '', { timeout: 6000 }).toMatch(PAGINA_BLOCCATA);
    const pagina = app.windows().find((w) => PAGINA_BLOCCATA.test(w.url()));
    await pagina.waitForTimeout(800);
    await pagina.screenshot({ path: `tests/.shots/590-g16-bloccato-${tema}.png` });
    await shell.screenshot({ path: `tests/.shots/590-g16-shell-${tema}.png` });
  });
}

test('E5 history.back() chiesto dalla pagina verso un sito messo in lista', async ({ app, shell, rete }) => {
  await lista(shell, []);
  const sito = rete.pagina('blocked.test', '/', '<h1>SITO</h1><script>window.__caricato = 1; document.title="SITO-VISTO"</script>');
  const altro = rete.pagina('sito.test', '/', '<h1>ALTRO</h1><button id="b" onclick="history.back()">indietro</button>');
  await apri(app, shell, sito);
  const { id } = await schedaSu(app, 'blocked.test');
  await shell.evaluate(([i, u]) => window.filoShell.tabs.navigate(i, u), [id, altro]);
  await expect.poll(async () => (await aperteSu(app, 'sito.test')).length, { timeout: 6000 }).toBe(1);
  await lista(shell, ['blocked.test']);
  const avvisi = await contaAvvisi(app);
  const tab = app.windows().find((w) => w.url().includes('sito.test'));
  await tab.click('#b');
  await shell.waitForTimeout(2500);
  console.log('E5 schede:', await schede(app), 'avvisi:', await avvisi());
});

test('E6 modulo POST e meta refresh verso il sito della lista', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  rete.pagina('blocked.test', '/x', '<h1>SITO</h1>');
  const pagina = rete.pagina('sito.test', '/', '<form id="f" method="post" action="http://blocked.test/x"><input name="a" value="1"></form><button id="b" onclick="document.getElementById(\'f\').submit()">invia</button>');
  await apri(app, shell, pagina);
  const tab = app.windows().find((w) => w.url().includes('sito.test'));
  await tab.click('#b');
  await shell.waitForTimeout(2000);
  console.log('E6 POST schede:', await schede(app));
  const meta = rete.pagina('libero.test', '/', '<meta http-equiv="refresh" content="0;url=http://blocked.test/x"><h1>META</h1>');
  await shell.evaluate((u) => window.filoShell.tabs.open(u), meta);
  await shell.waitForTimeout(2500);
  console.log('E6 meta schede:', await schede(app));
});

test('E7 voci della lista scritte in altre forme', async ({ app, shell, rete }) => {
  rete.pagina('blocked.test', '/', '<h1>SITO</h1>');
  rete.pagina('sito.test', '/', '<h1>SITO2</h1>');
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  await expect.poll(() => !!app.windows().find((w) => w.url().startsWith('filo://security')), { timeout: 8000 }).toBe(true);
  const pref = app.windows().find((w) => w.url().startsWith('filo://security'));
  await pref.waitForLoadState('domcontentloaded');
  const campo = pref.locator('#sec-siteblock-blacklist');
  for (const testo of ['.blocked.test', 'blocked.test, sito.test', 'blocked.test sito.test', '*.blocked.test']) {
    await campo.scrollIntoViewIfNeeded();
    await campo.fill(testo);
    await campo.dispatchEvent('change');
    await pref.waitForTimeout(600);
    const errore = await pref.locator('#sec-siteblock-blacklist-error').isVisible() ? await pref.locator('#sec-siteblock-blacklist-error').innerText() : '(nessun avviso)';
    const salvata = await pref.evaluate(async () => ((await window.SN_STORAGE.getSettings()).security?.siteBlock || {}).blacklist);
    const esito = await app.evaluate(({ BrowserWindow }) => {
      const sb = require('/home/user/Filo/src/main/services/siteBlock.js');
      return ['http://blocked.test/', 'http://sito.test/'].map((u) => sb.shouldBlockNavigation(u).block);
    }).catch((e) => String(e));
    console.log(`E7 «${testo}» → avviso: ${errore} | salvata: ${JSON.stringify(salvata)} | blocca [blocked, sito]: ${JSON.stringify(esito)}`);
  }
});

test('E8 barra della home: «/blocked.test/pagina» scritto come lo scrive un utente', async ({ app, shell, rete }) => {
  await lista(shell, ['blocked.test']);
  rete.pagina('blocked.test', '/pagina', '<h1>SITO</h1>');
  const page = await newtabPage(app);
  await page.evaluate(() => { window.filo.siteResolves = async () => ({ ok: true, resolves: true }); });
  const avvisi = await contaAvvisi(app);
  await page.locator('#input').fill('/blocked.test/pagina');
  await page.locator('#input').press('Enter');
  await shell.waitForTimeout(2000);
  console.log('E8 avvisi:', await avvisi(), 'schede:', await schede(app), 'input:', await page.locator('#input').inputValue());
});
