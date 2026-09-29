// #771 giro 4: in chat, senza fornitore, «da un altro paese» non salva, non instrada e non lo dà per fatto.
// Modello a copione (un elemento per giro) sulla chat vera della home; col fornitore la regola si salva.

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

async function configureModel(app) {
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

async function installScript(app, script) {
  await app.evaluate(async (_electron, script) => {
    globalThis.__captured = [];
    let i = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const step = script[Math.min(i++, script.length - 1)];
      globalThis.__captured.push({ messages: JSON.parse(JSON.stringify(messages)) });
      await new Promise((r) => setTimeout(r, 40));
      for (const c of step.toolCalls || []) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (step.text) { try { onDelta && onDelta(step.text); } catch (_) {} }
      return {
        text: step.text || '', toolCalls: step.toolCalls || [], reasoningDetails: [],
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
      };
    };
  }, script);
}

const regole = (app) => app.evaluate(() => globalThis.SN_FILO_MEMORY.listProxyRules());
const lastFilo = (page) => page.locator('.dash-bubble-filo').last();

async function send(page, text) {
  await page.locator('#input').fill(text);
  await page.locator('#sendBtn').click();
}

async function webTabProxy(app) {
  return app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w._filoTabs) continue;
      for (const t of w._filoTabs.tabs) if (/^https?:/.test(t.url || '')) return { id: t.id, proxy: t.proxy || null };
    }
    return null;
  });
}

test('regola «sempre dagli USA»: il giro dopo il rifiuto scrive la risposta, la conferma falsa non è nella bolla', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  const falsa = 'Fatto, da ora netflix si apre sempre dagli Stati Uniti.';
  const vera = 'Aprire un sito da un altro paese in Filo non è ancora disponibile: non ho salvato nessuna regola.';
  await installScript(app, [
    { text: falsa, toolCalls: [{ id: 'r1', name: 'REGOLA_PROXY_DOMINIO', arguments: '{"country":"us","dominio":"netflix.com"}' }] },
    { text: '' },
    { text: vera },
  ]);
  await send(page, 'apri sempre netflix dagli USA');
  await expect(lastFilo(page)).toContainText(vera, { timeout: 20_000 });
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 5_000 });
  expect(await lastFilo(page).innerText()).not.toContain('Fatto, da ora');
  expect(await regole(app)).toEqual({});
  // Il modello ha avuto davanti l'esito «non fatto» prima di rispondere.
  const cap = await app.evaluate(() => globalThis.__captured.map((c) => JSON.stringify(c.messages)));
  expect(cap.length).toBe(3);
  expect(cap[1]).toContain('NON fatto');
  expect(cap[2]).toContain('ultimo messaggio è vuoto');
  // Il diario lo dice.
  await page.locator('.dash-activity-head').last().click().catch(() => {});
  await expect(page.locator('.dash-activity-row', { hasText: 'Regola non salvata' }).last()).toBeAttached();
});

test('regola, modello muto due volte: la bolla dice che non si può e non promette', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await installScript(app, [
    { text: 'Fatto!', toolCalls: [{ id: 'r1', name: 'REGOLA_PROXY_DOMINIO', arguments: '{"country":"us","dominio":"netflix.com"}' }] },
    { text: '' },
    { text: '' },
  ]);
  await send(page, 'apri sempre netflix dagli USA');
  await expect(lastFilo(page)).toContainText('non si può ancora', { timeout: 20_000 });
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 5_000 });
  expect(await regole(app)).toEqual({});
});

test('«apri questa scheda dalla Francia»: scheda non instradata e risposta che lo dice', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  const url = testServer.html('<title>SITO</title><p>ciao</p>');
  await openTab(url);
  await configureModel(app);
  const vera = 'Da un altro paese non si può ancora aprire: la scheda resta com’è.';
  await installScript(app, [
    { text: '', toolCalls: [{ id: 'p1', name: 'PROXY_TAB', arguments: '{"country":"fr"}' }] },
    { text: vera },
  ]);
  await send(page, 'apri questa scheda dalla Francia');
  await expect(lastFilo(page)).toContainText(vera, { timeout: 20_000 });
  expect((await webTabProxy(app)).proxy).toBeNull();
});

test('col fornitore la regola si salva come prima', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: 'socks5://127.0.0.1:9' } });
  });
  await installScript(app, [
    { text: '', toolCalls: [{ id: 'r1', name: 'REGOLA_PROXY_DOMINIO', arguments: '{"country":"us","dominio":"netflix.com"}' }] },
    { text: 'Fatto: netflix si aprirà dagli Stati Uniti.' },
  ]);
  await send(page, 'apri sempre netflix dagli USA');
  await expect(lastFilo(page)).toContainText('Fatto: netflix', { timeout: 20_000 });
  const r = await regole(app);
  expect(r['netflix.com'] && r['netflix.com'].country).toBe('us');
});

test('porta del giro 2: la frase scritta sapendolo, con una pagina aperta, resta la risposta senza sollecito', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  const url = testServer.html('<title>QUI</title><p>qui</p>');
  const frase = 'Da un altro paese non si può ancora: ti apro la pagina qui.';
  await installScript(app, [
    { text: '', toolCalls: [{ id: 'p1', name: 'PROXY_TAB', arguments: '{"country":"fr"}' }] },
    { text: frase, toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url }) }] },
    { text: '' },
    { text: 'NON DEVE ARRIVARE' },
  ]);
  await send(page, 'apri questa scheda dalla Francia');
  await expect(lastFilo(page)).toContainText(frase, { timeout: 20_000 });
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 5_000 });
  expect(await app.evaluate(() => globalThis.__captured.length)).toBe(3);
  expect(await lastFilo(page).innerText()).not.toContain('NON DEVE ARRIVARE');
});

test('porta del giro 2: pagina aperta e instradamento nello stesso giro, poi muto due volte: nessun «non ho cambiato niente»', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  const url = testServer.html('<title>NF</title><p>nf</p>');
  await installScript(app, [
    { text: 'Ti apro Netflix dagli Stati Uniti.', toolCalls: [
      { id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url }) },
      { id: 'p1', name: 'PROXY_TAB', arguments: '{"country":"us"}' },
    ] },
    { text: '' },
    { text: '' },
  ]);
  await send(page, 'apri netflix dagli USA');
  await expect(lastFilo(page)).toContainText('non si può ancora', { timeout: 20_000 });
  expect(await lastFilo(page).innerText()).not.toContain('non ho cambiato niente');
});
