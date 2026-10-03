// Esplorazione del giro 3: screenshot del pannello e del bottone, chiaro e scuro.
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

async function configure(app, theme) {
  await app.evaluate(async (_e, th) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      theme: th,
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test', tavily: '' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  }, theme);
}

async function fakeChat(app, giri) {
  await app.evaluate(async (_electron, g) => {
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, giri);
}

async function seedArchive(app, schede, { ritardo = 0, embedRotto = false } = {}) {
  await app.evaluate(async (_electron, { schede: s, ritardo: rit, embedRotto: rotto }) => {
    const EM = globalThis.SN_TEST_MODELS.registry['qwen-embed'].model;
    const items = s.map((x, i) => ({
      id: `t${i}`, url: `https://sito${i}.example.com/`, title: x.title, favicon: '',
      closedAt: new Date(Date.now() - i * 1000).toISOString(), reason: 'manual', coOpenUrls: [], snippet: x.title,
      ...(x.senzaVettore ? {} : { embedding: x.gatto ? [127, 0] : [0, 127], embedModel: EM }),
    }));
    await chrome.storage.local.set({ [globalThis.SN_CONST.STORAGE_KEYS.ARCHIVED_TABS]: items });
    globalThis.SN_PROVIDER_OPENROUTER.embed = async ({ texts }) => {
      if (rotto) throw Object.assign(new Error('503 upstream'), { status: 503 });
      return { vectors: texts.map(() => [1, 0]) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const sys = String(messages[0] && messages[0].content || '');
      const out = (text) => ({ text, provider: attempts[0].provider, model: attempts[0].model, usage: {} });
      if (!/eliminare dall'archivio/.test(sys)) return out('{}');
      if (rit) await new Promise((r) => setTimeout(r, rit));
      const user = String(messages[1].content || '');
      const presi = [...user.matchAll(/^#(\d+) (.*)$/gm)].filter((m) => /gatt/i.test(m[2])).map((m) => Number(m[1]));
      return out(JSON.stringify({ pertinenti: presi }));
    };
  }, { schede, ritardo, embedRotto });
}

async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

for (const theme of ['light', 'dark']) {
  test(`aspetto pannello e bottone, ${theme}`, async ({ app, shell }) => {
    test.setTimeout(90_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await expect(page.locator('#input')).toBeVisible();
    await configure(app, theme);
    await page.reload();
    await expect(page.locator('#input')).toBeVisible();
    console.log('TEMA', await page.locator('html').getAttribute('data-sn-theme'));
    await app.evaluate(({ nativeTheme }, th) => { nativeTheme.themeSource = th; }, theme);
    const schede = [
      { title: 'Gatti persiani: carattere, cura del pelo e alimentazione, guida completa per chi vuole adottarne uno', gatto: true },
      { title: 'Il Gattopardo, recensione', gatto: true },
      { title: 'Cibo per gatti <b>bold</b> 🐱', gatto: true },
      { title: 'Ricetta della torta', gatto: false },
    ];
    for (let i = 0; i < 120; i++) schede.push({ title: `Vecchia ${i}`, senzaVettore: true });
    await seedArchive(app, schede, { ritardo: 700 });
    await fakeChat(app, [
      { toolCalls: [{ id: 'p1', name: 'PULISCI_TAB', arguments: '{}' }, { id: 'c1', name: 'CANCELLA_ARCHIVIO', arguments: '{"query":"pagine sui gatti"}' }] },
      { text: 'Ecco: il riordino parte dal bottone, e qui sotto le schede sui gatti.' },
    ]);
    await chiedi(page, 'fai pulizia delle schede e cancella dall\'archivio le pagine sui gatti');
    const note = page.locator('.dash-delete-panel .dash-delete-note');
    await expect(note).toContainText(/schede guardate/, { timeout: 15_000 });
    await page.screenshot({ path: `tests/.shots/825-3-g3-${theme}-avanzamento.png` });
    await expect(page.locator('.dash-delete-list li')).toHaveCount(3, { timeout: 15_000 });
    await page.locator('.dash-delete-list li').nth(1).getByRole('checkbox').uncheck();
    await page.locator('.dash-delete-list li').nth(0).hover();
    await page.screenshot({ path: `tests/.shots/825-3-g3-${theme}-elenco.png` });
    const html = await page.locator('.dash-delete-list li').nth(2).innerHTML();
    console.log('LI2', html);
  });
}

test('embedding non disponibile: cosa dice il pannello', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configure(app, 'light');
  await seedArchive(app, [{ title: 'Gatti persiani', gatto: true }, { title: 'Torta', gatto: false }], { embedRotto: true });
  await fakeChat(app, [
    { toolCalls: [{ id: 'c1', name: 'CANCELLA_ARCHIVIO', arguments: '{"query":"gatti"}' }] },
    { text: 'Ecco.' },
  ]);
  await chiedi(page, 'cancella dall\'archivio le pagine sui gatti');
  const panel = page.locator('.dash-delete-panel');
  await page.waitForTimeout(4000);
  console.log('NOTA', await panel.locator('.dash-delete-note').textContent());
  console.log('BOTTONI', await panel.locator('.dash-action-btn').allTextContents());
  await page.screenshot({ path: 'tests/.shots/825-3-g3-embed-rotto.png' });
});

test('chat riaperta dall\'archivio: cosa racconta di una cancellazione mai confermata', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configure(app, 'light');
  await seedArchive(app, [{ title: 'Gatti persiani', gatto: true }, { title: 'Torta', gatto: false }]);
  await fakeChat(app, [
    { toolCalls: [{ id: 'p1', name: 'PULISCI_TAB', arguments: '{}' }, { id: 'c1', name: 'CANCELLA_ARCHIVIO', arguments: '{"query":"gatti"}' }] },
    { text: 'Ecco: premi il bottone per riordinare, e qui sotto le schede da eliminare.' },
  ]);
  await chiedi(page, 'fai pulizia delle schede e cancella dall\'archivio le pagine sui gatti');
  await expect(page.locator('.dash-delete-list li')).toHaveCount(1, { timeout: 15_000 });
  await page.waitForTimeout(1500);
  const chats = await app.evaluate(() => globalThis.SN_FILO_CHATS.list());
  console.log('CHATS', JSON.stringify(chats.map((c) => ({ id: c.id, msgs: c.messages }))));
  await app.evaluate((_e, id) => globalThis.SN_CLOSE_FILO_CHAT(id), chats[0].id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chats[0].id)}`);
  await expect(page.locator('.dash-bubble')).toHaveCount(2, { timeout: 8_000 });
  console.log('REPLAY', await page.locator('.dash-bubble-note[data-replay]').allTextContents());
  await page.screenshot({ path: 'tests/.shots/825-3-g3-replay.png' });
});
