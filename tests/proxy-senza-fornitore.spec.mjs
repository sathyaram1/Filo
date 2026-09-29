// #771 — finché non c'è un fornitore di indirizzi esteri, «Apri da un altro
// paese» è spenta davvero: il livello 2 del riconoscimento dei blocchi non
// interroga il modello, la chat non salva regole né instrada e lo dice, il
// riquadro in Sicurezza non c'è, e l'errore -130 di una scheda normale non
// parla di altri paesi. Col fornitore tutto torna com'era (spec proxy-tab-*,
// geo-block-*).

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';

// Endpoint finto: nessuno ascolta, e verso 127.0.0.1 Chromium va comunque diretto.
const FORNITORE = 'socks5://127.0.0.1:9';

async function startServer() {
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/vietato') {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>403</title><h1 id="msg">Access denied to this resource.</h1>');
    } else {
      // 2xx quasi vuota: un'immagine aperta da sola, meno di 40 caratteri di testo.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>img</title><img id="msg" alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    async close() {
      try { server.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => server.close(r));
    },
  };
}

async function webTab(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w && w._filoTabs.tabs.find((x) => /^https?:/.test(x.url || ''));
    return t ? { id: t.id, url: t.url, proxy: t.proxy ? { ...t.proxy } : null } : null;
  });
}

async function navigate(app, tabId, url) {
  await app.evaluate(({ BrowserWindow }, args) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w._filoTabs.navigate(args.tabId, args.url);
  }, { tabId, url });
}

async function setFornitore(app, datacenter) {
  await app.evaluate(async (_e, dc) => {
    await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: dc } });
  }, datacenter);
}

test('livello 2: senza fornitore 403 e pagina quasi vuota non chiamano il modello; col fornitore sì', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const srv = await startServer();
  try {
    // Un modello configurato per il classificatore: senza, la catena dei
    // tentativi si ferma prima del fornitore e la spia non vedrebbe niente comunque.
    // Spia sul fornitore di modelli: conta solo le chiamate del classificatore.
    await app.evaluate(async () => {
      const C = globalThis.SN_CONST;
      await globalThis.SN_STORAGE.updateSettings({
        useDefaultModels: false,
        apiKeys: { openrouter: 'k-test' },
        models: { [C.ACTIONS.GEOBLOCK_CLASSIFY]: 'deepseek-flash' },
        modelRegistry: globalThis.SN_TEST_MODELS.registry,
      });
      const P = globalThis.SN_PROVIDERS;
      const orig = P.completeWithFallback;
      globalThis.__geoLlm = 0;
      P.completeWithFallback = async (opts) => {
        const sys = String((((opts && opts.messages) || [])[0] || {}).content || '');
        if (sys.startsWith('Sei un classificatore.')) {
          globalThis.__geoLlm += 1;
          return { text: 'errore_generico', model: 'spia', provider: 'spia', usage: {} };
        }
        return orig(opts);
      };
    });
    const chiamate = () => app.evaluate(() => globalThis.__geoLlm);

    const page = await openTab(`${srv.origin}/vietato`);
    await page.waitForSelector('#msg');
    await new Promise((r) => setTimeout(r, 3500)); // oltre il secondo campione di testo
    const tab = await webTab(app);
    await navigate(app, tab.id, `${srv.origin}/vuota`);
    await expect.poll(async () => (await webTab(app)).url, { timeout: 10_000 }).toBe(`${srv.origin}/vuota`);
    await new Promise((r) => setTimeout(r, 3500));
    expect(await chiamate()).toBe(0);

    // Col fornitore la stessa coda ambigua torna a interrogare il modello.
    await setFornitore(app, FORNITORE);
    await navigate(app, tab.id, `${srv.origin}/vietato`);
    await expect.poll(chiamate, { timeout: 15_000 }).toBeGreaterThan(0);
    const dopo403 = await chiamate();
    await navigate(app, tab.id, `${srv.origin}/vuota`);
    await expect.poll(chiamate, { timeout: 15_000 }).toBeGreaterThan(dopo403);
  } finally {
    await srv.close();
  }
});

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('chat senza fornitore: niente regola salvata né scheda instradata, e il modello sa che non è disponibile', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__calls = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, tools }) => {
      const n = globalThis.__calls.push({ messages: JSON.parse(JSON.stringify(messages)), tools: (tools || []).map((t) => t.function.name) });
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (n === 1) {
        return {
          ...base, text: '',
          toolCalls: [
            { id: 'r1', name: 'REGOLA_PROXY_DOMINIO', arguments: '{"country":"us","dominio":"netflix.com"}' },
            { id: 'p1', name: 'PROXY_TAB', arguments: '{"country":"fr"}' },
          ],
          finishReason: 'tool_calls',
        };
      }
      return { ...base, text: 'RISPOSTA_FINALE', toolCalls: [], finishReason: 'stop' };
    };
  });

  await page.locator('#input').fill('apri sempre netflix dagli USA');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA_FINALE' })).toBeVisible({ timeout: 15_000 });

  // Gli strumenti restano offerti (prefisso in cache stabile): è l'esito a dire di no.
  const calls = await app.evaluate(() => globalThis.__calls);
  expect(calls.length).toBe(2);
  expect(calls[0].tools).toEqual(expect.arrayContaining(['PROXY_TAB', 'REGOLA_PROXY_DOMINIO']));
  const esito = (id) => (calls[1].messages.find((m) => m.role === 'tool' && m.tool_call_id === id) || {}).content || '';
  for (const id of ['r1', 'p1']) {
    expect(esito(id)).toMatch(/aprire da un altro paese non è ancora disponibile/);
    expect(esito(id)).toMatch(/senza darlo per fatto/);
  }

  // Nessuna regola scritta, nessuna scheda instradata.
  const regole = await app.evaluate(async () => globalThis.SN_FILO_MEMORY.listProxyRules());
  expect(Object.keys(regole || {})).toEqual([]);
  const instradate = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .filter((w) => w._filoTabs).flatMap((w) => w._filoTabs.tabs).filter((t) => t.proxy).length);
  expect(instradate).toBe(0);

  // Nel diario la riga dice perché.
  const activity = page.locator('.dash-activity');
  await activity.locator('.dash-activity-head').click();
  const body = activity.locator('.dash-activity-body');
  await expect(body.locator('.dash-activity-row', { hasText: 'Regola non salvata · non ancora disponibile' })).toHaveCount(1);
  await expect(body.locator('.dash-activity-row', { hasText: 'Scheda non instradata · non ancora disponibile' })).toHaveCount(1);
  await page.screenshot({ path: 'tests/.shots/771-chat-non-disponibile.png' }).catch(() => {});
});

// Il modello scrive «fatto» insieme alla chiamata e dopo il rifiuto resta muto:
// la sua frase non diventa la risposta, Filo dice che non si può.
test('chat senza fornitore con l\'ultimo giro muto: la frase «fatto» non resta la risposta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const turni = [
      { text: 'PROMESSA_REGOLA: da ora netflix si apre sempre dagli Stati Uniti.', toolCalls: [{ id: 'r1', name: 'REGOLA_PROXY_DOMINIO', arguments: '{"country":"us","dominio":"netflix.com"}' }] },
      { text: '' },
      { text: 'PROMESSA_SCHEDA: fatto, la scheda ora arriva dalla Francia.', toolCalls: [{ id: 'p1', name: 'PROXY_TAB', arguments: '{"country":"fr"}' }] },
      { text: '' },
    ];
    let i = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts }) => {
      const t = turni[Math.min(i++, turni.length - 1)];
      return {
        text: t.text, toolCalls: t.toolCalls || [], reasoningDetails: [],
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        finishReason: t.toolCalls ? 'tool_calls' : 'stop',
      };
    };
  });

  const risposte = page.locator('.dash-bubble-filo', { hasText: 'da un altro paese in Filo non si può ancora' });
  await page.locator('#input').fill('apri sempre netflix dagli USA');
  await page.locator('#sendBtn').click();
  await expect(risposte).toHaveCount(1, { timeout: 15_000 });
  await page.locator('#input').fill('apri questa scheda dalla Francia');
  await page.locator('#sendBtn').click();
  await expect(risposte).toHaveCount(2, { timeout: 15_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'PROMESSA_' })).toHaveCount(0);
  const regole = await app.evaluate(async () => globalThis.SN_FILO_MEMORY.listProxyRules());
  expect(Object.keys(regole || {})).toEqual([]);
  await page.screenshot({ path: 'tests/.shots/771-chat-giro-muto.png' }).catch(() => {});
});

// Formato vecchio (JSON nel testo): la frase scritta insieme all'azione la dava
// per fatta, e senza un esito da leggere il turno finiva lì.
test('chat nel formato vecchio: l\'esito «non disponibile» torna al modello e la sua frase non resta la risposta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const turni = [
      { text: 'FRASE_PROMESSA: netflix si aprirà sempre dagli USA.', actions: [{ type: 'REGOLA_PROXY_DOMINIO', country: 'us', dominio: 'netflix.com' }] },
      { text: 'RISPOSTA_LEGACY', actions: [] },
    ];
    globalThis.__legacy = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages }) => {
      const n = globalThis.__legacy.push(JSON.stringify(messages || []));
      return { text: JSON.stringify(turni[Math.min(n - 1, 1)]), model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });

  await page.locator('#input').fill('apri sempre netflix dagli USA');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA_LEGACY' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'FRASE_PROMESSA' })).toHaveCount(0);
  const giri = await app.evaluate(() => globalThis.__legacy);
  expect(giri.length).toBe(2);
  expect(giri[1]).toContain('aprire da un altro paese non è ancora disponibile');
  const regole = await app.evaluate(async () => globalThis.SN_FILO_MEMORY.listProxyRules());
  expect(Object.keys(regole || {})).toEqual([]);
});

test('Sicurezza: il riquadro «da un altro paese» c\'è solo col fornitore, col suo host', async ({ app, openTab }) => {
  const sec = await openTab('filo://security/security.html');
  await sec.waitForLoadState('domcontentloaded');
  await expect(sec.locator('#sec-proxy-box-title')).not.toBeEmpty();
  await sec.waitForTimeout(800); // la risposta del main sullo stato
  await expect(sec.locator('#sec-proxy-box')).toBeHidden();
  await sec.screenshot({ path: 'tests/.shots/771-sicurezza-senza.png', fullPage: true }).catch(() => {});

  const imposta = (dc) => sec.evaluate(async (d) => {
    await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { proxy: { datacenter: d } } });
  }, dc);

  // Configurato mentre la pagina è aperta: il riquadro compare da sé.
  await imposta('socks5://user-{country}:pw@gate.testprovider.net:7000');
  await expect(sec.locator('#sec-proxy-box')).toBeVisible({ timeout: 8_000 });
  await expect(sec.locator('#sec-proxy-box-provider')).toContainText('gate.testprovider.net');
  await expect(sec.locator('#sec-proxy-box-provider')).not.toContainText('pw');
  await sec.locator('#sec-proxy-box').screenshot({ path: 'tests/.shots/771-sicurezza-con.png' }).catch(() => {});

  // Lo stato del fornitore lo chiede solo una pagina di Filo, non un sito visitato.
  const daSito = await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE(
    { type: globalThis.SN_MSG.MSG.PROXY_STATUS }, { tab: { id: 1, url: 'https://sito-qualunque.example/' } }));
  expect(daSito).toMatchObject({ ok: false, code: 'forbidden' });
  expect(daSito.providerHost).toBeUndefined();

  await imposta('');
  await expect(sec.locator('#sec-proxy-box')).toBeHidden({ timeout: 8_000 });
});

// Il testo del consiglio sulla pagina d'errore della scheda, quando compare.
async function hintErrore(app, tabId) {
  let hint = '';
  await expect.poll(async () => {
    hint = await app.evaluate(async ({ BrowserWindow }, id) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      const t = w._filoTabs.tabs.find((x) => x.id === id);
      const wc = t && t.view && t.view.webContents;
      if (!wc || !wc.getURL().startsWith('filo://error/')) return '';
      try { return await wc.executeJavaScript("(document.getElementById('err-hint')||{}).textContent||''"); } catch (_) { return ''; }
    }, tabId);
    return hint;
  }, { timeout: 20_000 }).not.toBe('');
  return hint;
}

test('-130: la scheda normale dietro un proxy di sistema non parla di altri paesi, quella instradata sì', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await openTab(testServer.html('<title>A</title><p id="a">a</p>'));
  await page.waitForSelector('#a');
  const { id } = await webTab(app);

  // Proxy «di sistema» (una rete aziendale) che non risponde.
  await app.evaluate(async ({ BrowserWindow }, tabId) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === tabId);
    await t.view.webContents.session.setProxy({ proxyRules: 'http://127.0.0.1:9' });
  }, id);
  await navigate(app, id, 'http://filo-771-diretta.example/');
  const diretta = await hintErrore(app, id);
  expect(diretta).toMatch(/proxy/i);
  expect(diretta).not.toMatch(/paese/i);
  await page.screenshot({ path: 'tests/.shots/771-errore-130-diretta.png' }).catch(() => {});
  await app.evaluate(async ({ BrowserWindow }, tabId) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.id === tabId);
    await t.view.webContents.session.setProxy({ mode: 'direct' });
  }, id);

  // La stessa scheda aperta da un altro paese, col fornitore che non risponde.
  await setFornitore(app, FORNITORE);
  const r = await app.evaluate(async ({ BrowserWindow }, tabId) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    return w._filoTabs.setTabProxy(tabId, 'fr');
  }, id);
  expect(r.ok).toBe(true);
  const estera = await hintErrore(app, id);
  expect(estera).toMatch(/altro paese/);
});
