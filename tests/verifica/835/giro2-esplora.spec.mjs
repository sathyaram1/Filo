// Verifica #835 giro 2 — esplorazione: il blocco chiesto a parole ferma davvero il sito, l'avviso dell'interruttore
// spento arriva anche dopo l'OK, gli inserimenti strani diventano un rifiuto leggibile.
import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm, confirmState } from '../../helpers/confirm.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';

async function trovaPagina(app, prova, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}
const homeDi = (app) => trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito'));
async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry, theme: 'light',
    });
  });
}
async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__imp_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__imp_tool = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const ultimo = [...messages].reverse().find((m) => m.role === 'tool');
      if (ultimo) globalThis.__imp_tool.push(String(ultimo.content || ''));
      const text = giro.text || '';
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (text) { try { onDelta && onDelta(text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, giri);
}
const sicurezza = async (app) => (await app.evaluate(async () => globalThis.SN_STORAGE.getSettings())).security;
const imposta = (chiave, valore, id = 'i1') => ({ toolCalls: [{ id, name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave, valore }) }] });
async function scrivi(page, testo) {
  await page.bringToFront();
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('esplora — «blocca blocked.test» dopo l\'OK ferma davvero il sito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await livelloAutonomia(app, 'conservativo');
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist: ['tiktok.com', 'facebook.com'] } } }));
  await modelloFinto(app, [imposta('siti_bloccati', 'blocca blocked.test', 'b1'), { text: 'Fatto.' }]);
  await scrivi(chat, 'blocca blocked.test');
  await expect.poll(async () => (await confirmState(chat))?.text || '', { timeout: 10_000 }).toContain('blocked.test');
  await clickConfirm(chat, 'ok');
  await expect.poll(async () => (await sicurezza(app)).siteBlock.blacklist, { timeout: 5_000 }).toEqual(['tiktok.com', 'facebook.com', 'blocked.test']);
  const target = testServer.html('<!doctype html><h1 id="t">BERSAGLIO</h1>').replace('127.0.0.1', 'blocked.test');
  const from = testServer.html(`<!doctype html><a id="go" href="${target}">vai</a>`);
  const page = await openTab(from);
  await page.waitForSelector('#go', { timeout: 8000 });
  await page.evaluate(() => document.getElementById('go').click());
  await expect(shell.locator('.shell-notif', { hasText: 'Sito bloccato' })).toHaveCount(1, { timeout: 6000 });
  await page.waitForTimeout(500);
  expect(page.url()).toBe(from);
  await app.evaluate(() => globalThis.__imp_restore?.());
});

test('esplora — a Conservativo, col blocco spento, l\'esito dopo l\'OK porta l\'avviso al modello', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await livelloAutonomia(app, 'conservativo');
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ security: { siteBlock: { enabled: false, blacklist: [] } } }));
  await modelloFinto(app, [imposta('siti_bloccati', 'aggiungi example.org', 'c1'), { text: 'RISPOSTA DOPO' }]);
  await scrivi(chat, 'blocca example.org');
  const st = await expect.poll(async () => (await confirmState(chat))?.text || '', { timeout: 10_000 }).toContain('example.org');
  console.log('POPUP:', (await confirmState(chat))?.text);
  await clickConfirm(chat, 'ok');
  await expect.poll(async () => (await sicurezza(app)).siteBlock.blacklist, { timeout: 5_000 }).toEqual(['example.org']);
  await page_wait(chat);
  const tool = await app.evaluate(() => globalThis.__imp_tool);
  console.log('TOOL:', JSON.stringify(tool));
  const bolle = await chat.locator('.dash-bubble-filo').allInnerTexts();
  console.log('BOLLE:', JSON.stringify(bolle));
  expect(tool.join('\n')).toContain('il blocco dei siti in blacklist è spento');
  void st;
  await app.evaluate(() => globalThis.__imp_restore?.());
});
async function page_wait(p) { await p.waitForTimeout(2500); }

test('esplora — «usa anche le liste pubbliche» col blocco spento: avviso', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ security: { siteBlock: { enabled: false, useAdblockLists: false } } }));
  await modelloFinto(app, [imposta('liste_pubbliche_blocco', 'sì', 'l1'), { text: 'OKK' }]);
  await scrivi(chat, 'usa anche le liste pubbliche');
  const s = await confirmState(chat).catch(() => null);
  if (s) { console.log('POPUP3:', s.text); await clickConfirm(chat, 'ok'); }
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'OKK' })).toBeVisible({ timeout: 10_000 });
  const tool = await app.evaluate(() => globalThis.__imp_tool);
  console.log('TOOL3:', JSON.stringify(tool));
  expect((await sicurezza(app)).siteBlock.useAdblockLists).toBe(true);
  expect(tool.join('\n')).toContain('è spento');
  await app.evaluate(() => globalThis.__imp_restore?.());
});

test('esplora — inserimenti strani: senza estensione, HTML, indirizzo lungo', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ security: { siteBlock: { enabled: true, blacklist: ['tiktok.com'] } } }));
  const casi = ['blocca facebook', 'blocca <img src=x onerror=alert(1)>.com', 'blocca https://www.Facebook.com/profile?id=1', '   ', 'blocca 🦊.com', 'blocca münchen.de'];
  let i = 0;
  for (const v of casi) {
    i += 1;
    await modelloFinto(app, [imposta('siti_bloccati', v, `s${i}`), { text: `FINE${i}` }]);
    await scrivi(chat, `prova ${i}`);
    const s = await expect.poll(async () => {
      const c = await confirmState(chat);
      if (c) return 'popup';
      return (await chat.locator('.dash-bubble-filo', { hasText: `FINE${i}` }).count()) ? 'fine' : '';
    }, { timeout: 10_000 }).not.toBe('');
    void s;
    const c = await confirmState(chat);
    if (c) { console.log(`CASO ${i} POPUP:`, c.text); await clickConfirm(chat, 'ok'); await chat.waitForTimeout(1500); }
    const tool = await app.evaluate(() => globalThis.__imp_tool);
    console.log(`CASO ${i} «${v}» TOOL:`, JSON.stringify(tool), 'ELENCO:', JSON.stringify((await sicurezza(app)).siteBlock.blacklist));
  }
  const html = await chat.locator('img[src="x"]').count();
  expect(html).toBe(0);
  await chat.screenshot({ path: 'tests/.shots/835-g2-strani.png' });
  await app.evaluate(() => globalThis.__imp_restore?.());
});
