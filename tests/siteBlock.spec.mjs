// Blocco apertura siti in blacklist (#170.3) — e2e.
//
// Assertiamo il COMPORTAMENTO, non un messaggio:
//   1) cliccare un link verso un sito in blacklist
//      → la navigazione è bloccata (la tab NON cambia URL) e compare la
//        notifica "Sito bloccato" con l'azione "Apri comunque";
//   2) "Apri comunque" apre davvero il sito, e vale per quel sito in quella scheda;
//   3) #590: ogni strada che cambia l'indirizzo di una scheda passa dalla lista —
//      barra della home, NAVIGA del modello (e la chat lo dice), link in nuova
//      scheda, redirect.
//
// Nessuna provenienza è esente, nemmeno una ricerca: tests/siteBlock-strade.spec.mjs.
//
// Per rendere il blocco deterministico usiamo un DOMINIO REALE finto,
// "blocked.test" (estensione valida → entra davvero in blacklist, a differenza
// di un IP che l'app scarta di proposito). Il fixture Electron mappa
// "blocked.test" → 127.0.0.1 via --host-resolver-rules, così le pagine sono
// comunque servite dal testServer locale. Disattiviamo le liste pubbliche per
// non dipendere dalla rete.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';

// Host finto messo in blacklist. Deve combaciare con la regola host-resolver
// del fixture (MAP blocked.test 127.0.0.1).
const BLOCKED_HOST = 'blocked.test';

async function enableBlock(shell) {
  await shell.evaluate((host) => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist: [host] } } },
  }), BLOCKED_HOST);
  // lascia propagare configureFromSettings nel main
  await shell.evaluate(() => new Promise((r) => setTimeout(r, 300)));
}

// URL servito dal testServer locale ma con hostname "blocked.test" (che il
// fixture risolve a 127.0.0.1): stesso contenuto, host in blacklist.
function blockedUrl(testServer, body) {
  return testServer.html(body).replace('127.0.0.1', BLOCKED_HOST);
}

test('blocco diretto: click su link verso sito in blacklist → bloccato + notifica', async ({ shell, openTab, testServer, avvisi }) => {
  await enableBlock(shell);

  const targetUrl = blockedUrl(testServer, '<!doctype html><meta charset="utf-8"><h1 id="t">TARGET BLOCCATO</h1>');
  const fromUrl = testServer.html(
    `<!doctype html><meta charset="utf-8"><a id="go" href="${targetUrl}">vai</a>`,
  );

  // La pagina di partenza viene aperta da Filo (programmatica) → consentita.
  const page = await openTab(fromUrl);
  await page.waitForSelector('#go', { timeout: 8000 });

  // Click sul link: è una navigazione top-level con referrer NON di ricerca.
  await page.evaluate(() => document.getElementById('go').click());

  // La notifica di blocco compare sopra la pagina, con l'azione "Apri comunque".
  await expect(shell.locator('.shell-notif', { hasText: 'Sito bloccato' })).toHaveCount(1, { timeout: 6000 });
  const card = (await avvisi()).locator('.shell-notif', { hasText: 'Sito bloccato' });
  await expect(card).toBeVisible({ timeout: 6000 });
  await expect(card.locator('.shell-notif-action', { hasText: 'Apri comunque' })).toBeVisible();

  // La tab NON ha navigato: è rimasta sulla pagina di partenza (la navigazione
  // verso il sito in blacklist è stata annullata).
  await page.waitForTimeout(500);
  expect(page.url()).toBe(fromUrl);
});

test('"Apri comunque" apre il sito, e i suoi link interni non vengono ribloccati', async ({ app, shell, openTab, testServer , avvisi }) => {
  await enableBlock(shell);

  const dentro = blockedUrl(testServer, '<!doctype html><meta charset="utf-8"><h1 id="t2">SECONDA PAGINA</h1>');
  const targetUrl = blockedUrl(testServer, `<!doctype html><meta charset="utf-8"><h1 id="t">APERTO COMUNQUE</h1><a id="dentro" href="${dentro}">avanti</a>`);
  const fromUrl = testServer.html(
    `<!doctype html><meta charset="utf-8"><a id="go" href="${targetUrl}">vai</a>`,
  );

  const page = await openTab(fromUrl);
  await page.waitForSelector('#go', { timeout: 8000 });
  await page.evaluate(() => document.getElementById('go').click());

  await expect(shell.locator('.shell-notif-action', { hasText: 'Apri comunque' })).toHaveCount(1, { timeout: 6000 });
  const action = (await avvisi()).locator('.shell-notif-action', { hasText: 'Apri comunque' });
  await expect(action).toBeVisible({ timeout: 6000 });
  await action.click();

  // Il sito si apre davvero: compare un WebContentsView che mostra il target.
  let aperta = null;
  await expect.poll(async () => {
    for (const w of app.windows()) {
      try {
        const has = await w.evaluate(() => !!document.getElementById('t') && document.getElementById('t').textContent.includes('APERTO COMUNQUE'));
        if (has) { aperta = w; return true; }
      } catch (_) {}
    }
    return false;
  }, { timeout: 8000 }).toBe(true);

  // #590 — la scelta vale per quel sito in quella scheda: il link interno naviga.
  const notifiche = await shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).count();
  await aperta.evaluate(() => document.getElementById('dentro').click());
  await expect(aperta.locator('#t2')).toHaveText('SECONDA PAGINA', { timeout: 8000 });
  expect(await shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).count()).toBeLessThanOrEqual(notifiche);
});

test('Sicurezza: il toggle e la blacklist dedicata persistono', async ({ openTab }) => {
  const page = await openTab('filo://security/security.html');
  await page.waitForSelector('#sec-siteblock', { timeout: 8000 });

  // I controlli esistono.
  await expect(page.locator('#sec-siteblock')).toHaveCount(1);
  await expect(page.locator('#sec-siteblock-lists')).toHaveCount(1);
  await expect(page.locator('#sec-siteblock-blacklist')).toHaveCount(1);

  // Aggiunge un dominio alla blacklist dedicata e salva (change).
  await page.locator('#sec-siteblock-blacklist').fill('cattivo.example\naltro.test');
  await page.locator('#sec-siteblock-blacklist').dispatchEvent('change');

  await expect
    .poll(() => page.evaluate(async () => {
      const sb = (await window.SN_STORAGE.getSettings()).security?.siteBlock || {};
      return sb.blacklist || [];
    }), { timeout: 4000 })
    .toEqual(['cattivo.example', 'altro.test']);

  // Sopravvive a una ricarica della pagina.
  await page.reload();
  await page.waitForSelector('#sec-siteblock-blacklist', { timeout: 8000 });
  await expect(page.locator('#sec-siteblock-blacklist')).toHaveValue('cattivo.example\naltro.test');
});

// Gli indirizzi delle schede aperte, letti dal TabManager (la verità, non la barra).
const tabUrls = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  return w ? w._filoTabs.tabs.map((t) => t.url) : [];
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

// La chat della home risponde coi giri scritti qui (tool call e testo), senza rete.
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
    globalThis.__fake590_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__fake590_calls = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis.__fake590_calls.push(JSON.parse(JSON.stringify(messages)));
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

// Un server che risponde 302 verso `to`: un accorciatore o un redirect aperto.
async function redirector(to) {
  const server = createServer((_req, res) => { res.writeHead(302, { Location: to }); res.end(); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/r`, close: () => new Promise((r) => server.close(r)) };
}

test('#590 barra della home: un indirizzo della lista non si apre, e «Apri comunque» lo apre', async ({ app, shell, testServer }) => {
  await enableBlock(shell);
  const page = await newtabPage(app);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8000 });
  // blocked.test esiste solo per Chromium (host-resolver-rules), non per il DNS di Node.
  await page.evaluate(() => { window.filo.siteResolves = async () => ({ ok: true, resolves: true }); });

  const target = blockedUrl(testServer, '<!doctype html><meta charset="utf-8"><h1 id="t">DALLA HOME</h1>');
  await input.fill(`/${target}`);
  await input.press('Enter');

  const card = shell.locator('.shell-notif', { hasText: 'Sito bloccato' });
  await expect(card).toBeVisible({ timeout: 6000 });
  await expect(card).toContainText(BLOCKED_HOST);
  await page.waitForTimeout(500);
  expect((await tabUrls(app)).filter((u) => u.includes(BLOCKED_HOST))).toEqual([]);

  await card.locator('.shell-notif-action', { hasText: 'Apri comunque' }).click();
  await expect.poll(async () => (await tabUrls(app)).includes(target), { timeout: 8000 }).toBe(true);
});

test('#590 NAVIGA del modello verso un sito della lista: nessuna scheda, e la chat lo dice', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  await enableBlock(shell);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8000 });

  const target = blockedUrl(testServer, '<!doctype html><meta charset="utf-8"><h1>DAL MODELLO</h1>');
  // Il modello simulato apre l'indirizzo intero e, come a volte fa, uno nudo.
  const giri = [
    { toolCalls: [
      { id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: target, etichetta: 'pagina' }) },
      { id: 'n2', name: 'NAVIGA', arguments: JSON.stringify({ url: `www.${BLOCKED_HOST}/altro`, etichetta: 'altra' }) },
    ] },
    { text: 'Non l’ho aperta: è fra i siti che hai bloccato.' },
  ];
  await modelloFinto(app, giri);

  try {
    await page.locator('#input').fill('apri quella pagina');
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Non l’ho aperta' })).toBeVisible({ timeout: 10_000 });

    await expect(shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).first()).toBeVisible({ timeout: 6000 });
    expect((await tabUrls(app)).filter((u) => u.includes(BLOCKED_HOST))).toEqual([]);

    // Il diario lo dice, e il riassunto non si vanta di un'apertura mai avvenuta.
    const activity = page.locator('.dash-activity');
    await expect(activity.locator('.dash-activity-label')).not.toContainText('aperto');
    await activity.locator('.dash-activity-head').click();
    const righe = activity.locator('.dash-activity-row', { hasText: 'Link non aperto' });
    await expect(righe).toHaveCount(2);
    await expect(righe.first()).toContainText(`${BLOCKED_HOST} è fra i siti bloccati`);
    await expect(righe.nth(1)).toContainText(`www.${BLOCKED_HOST} è fra i siti bloccati`);
    await page.screenshot({ path: 'tests/.shots/590-naviga-bloccata.png' });

    // Il modello sa perché, e sa che non deve cercare un'altra strada.
    const calls = await app.evaluate(() => globalThis.__fake590_calls);
    const secondo = JSON.stringify(calls[1] || []);
    expect(secondo).toContain('lista dei siti bloccati');
    expect(secondo).not.toContain('Proposta all');
  } finally {
    await app.evaluate(() => { try { globalThis.__fake590_restore?.(); } catch (_) {} });
  }
});

test('#590 NAVIGA verso un accorciatore che rimbalza sul sito della lista: la chat e l\'assistente sulla pagina dicono il blocco', async ({ app, shell, testServer }) => {
  test.setTimeout(60_000);
  await enableBlock(shell);
  const r = await redirector(blockedUrl(testServer, '<!doctype html><meta charset="utf-8"><h1>X</h1>'));
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8000 });
  await modelloFinto(app, [
    { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: r.url, etichetta: 'corto' }) }] },
    { text: 'RISPOSTA-FINTA' },
  ]);
  try {
    await page.locator('#input').fill('apri quel link');
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA-FINTA' })).toBeVisible({ timeout: 10_000 });
    expect((await tabUrls(app)).filter((u) => u.includes(BLOCKED_HOST))).toEqual([]);
    const activity = page.locator('.dash-activity');
    await activity.locator('.dash-activity-head').click();
    await expect(activity.locator('.dash-activity-row', { hasText: 'Link non aperto' })).toContainText(`${BLOCKED_HOST} è fra i siti bloccati`);
    const secondo = JSON.stringify((await app.evaluate(() => globalThis.__fake590_calls))[1] || []);
    expect(secondo).toContain('lista dei siti bloccati');

    await page.waitForFunction(() => !!window.SN_SIDEBAR && !!window.__filoSidebarTest, null, { timeout: 8000 });
    await page.evaluate(() => window.SN_SIDEBAR.open());
    const esito = await page.evaluate((u) => window.__filoSidebarTest.runFiloAction({ type: 'NAVIGA', url: u }), r.url);
    expect(esito).toBe(false);
    await expect(page.locator('.sn-sidebar-log').last()).toContainText(`${BLOCKED_HOST} è fra i siti bloccati`);
  } finally {
    await app.evaluate(() => { try { globalThis.__fake590_restore?.(); } catch (_) {} });
    await r.close();
  }
});

for (const [forma, corpo] of [
  ['un rinvio scritto nella pagina', (b) => `<meta http-equiv="refresh" content="0;url=${b}"><p>ti porto di là</p>`],
  ['uno script', (b) => `<p>ti porto di là</p><script>location.replace(${JSON.stringify(b)})</script>`],
]) {
  test(`#590 NAVIGA verso una pagina che rimanda da sé (${forma}) al sito della lista: la chat e il modello sanno che non si è aperto`, async ({ app, shell, testServer }) => {
    test.setTimeout(60_000);
    await enableBlock(shell);
    const passaggio = testServer.html(`<!doctype html><meta charset="utf-8">${corpo(blockedUrl(testServer, '<!doctype html><h1>X</h1>'))}`);
    const page = await newtabPage(app);
    await expect(page.locator('#input')).toBeVisible({ timeout: 8000 });
    await modelloFinto(app, [
      { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: passaggio, etichetta: 'corto' }) }] },
      { text: 'RISPOSTA-FINTA' },
    ]);
    try {
      await page.locator('#input').fill('apri quel link');
      await page.locator('#sendBtn').click();
      await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA-FINTA' })).toBeVisible({ timeout: 15_000 });
      expect((await tabUrls(app)).filter((u) => u.includes(BLOCKED_HOST))).toEqual([]);
      const activity = page.locator('.dash-activity');
      await activity.locator('.dash-activity-head').click();
      await expect(activity.locator('.dash-activity-row', { hasText: 'Link non aperto' })).toContainText(`${BLOCKED_HOST} è fra i siti bloccati`);
      const risposte = ((await app.evaluate(() => globalThis.__fake590_calls))[1] || []).filter((m) => m && m.role === 'tool');
      expect(JSON.stringify(risposte)).toContain('NON aperta');
    } finally {
      await app.evaluate(() => { try { globalThis.__fake590_restore?.(); } catch (_) {} });
    }
  });
}

test('#590 NAVIGA verso un sito delle liste pubbliche: né il modello né la notifica lo chiamano un divieto dell\'utente', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await app.evaluate(() => { globalThis.__filoAdblock.setDomainsForTest(['tracker.test']); });
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: true, blacklist: [] } } },
  }));
  await shell.evaluate(() => new Promise((r) => setTimeout(r, 300)));
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8000 });
  await modelloFinto(app, [
    { toolCalls: [{ id: 'n1', name: 'NAVIGA', arguments: JSON.stringify({ url: 'http://tracker.test/x', etichetta: 'pagina' }) }] },
    { text: 'RISPOSTA-FINTA' },
  ]);
  try {
    await page.locator('#input').fill('apri quella pagina');
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA-FINTA' })).toBeVisible({ timeout: 10_000 });
    const risposte = JSON.stringify(((await app.evaluate(() => globalThis.__fake590_calls))[1] || []).filter((m) => m && m.role === 'tool'));
    expect(risposte).toContain('pubblicità e tracciamento');
    expect(risposte).not.toContain('è nella lista dei siti bloccati dell');
    await expect(shell.locator('.shell-notif', { hasText: 'tracker.test' }).first()).toContainText('pubblicità e tracciamento');
    const activity = page.locator('.dash-activity');
    await activity.locator('.dash-activity-head').click();
    await expect(activity.locator('.dash-activity-row', { hasText: 'Link non aperto' })).toContainText('tracker.test è fra i siti di pubblicità e tracciamento');
  } finally {
    await app.evaluate(() => { try { globalThis.__fake590_restore?.(); } catch (_) {} });
  }
});

test('#590 link in una nuova scheda e redirect verso un sito della lista: bloccati', async ({ app, shell, openTab, testServer }) => {
  await enableBlock(shell);
  const target = blockedUrl(testServer, '<!doctype html><meta charset="utf-8"><h1 id="t">ARRIVATO</h1>');
  const r = await redirector(target);
  try {
    const fromUrl = testServer.html(
      `<!doctype html><meta charset="utf-8"><a id="blank" href="${target}" target="_blank">nuova</a> <a id="redir" href="${r.url}">accorciato</a>`,
    );
    const page = await openTab(fromUrl);
    await page.waitForSelector('#redir', { timeout: 8000 });
    const prima = (await tabUrls(app)).length;

    await page.evaluate(() => document.getElementById('blank').click());
    await expect(shell.locator('.shell-notif', { hasText: 'Sito bloccato' }).first()).toBeVisible({ timeout: 6000 });
    await page.waitForTimeout(500);
    expect((await tabUrls(app)).length).toBe(prima);

    // Il primo salto è lecito, il secondo porta nella lista: la scheda resta dov'era.
    await page.evaluate(() => document.getElementById('redir').click());
    await page.waitForTimeout(1500);
    expect(page.url()).toBe(fromUrl);
    expect((await tabUrls(app)).filter((u) => u.includes(BLOCKED_HOST))).toEqual([]);

    // Lo stesso redirect aperto da Filo in una scheda nuova: niente scheda bianca che resta.
    await shell.evaluate((u) => window.filoShell.tabs.open(u), r.url);
    await page.waitForTimeout(1500);
    await expect.poll(async () => (await tabUrls(app)).length, { timeout: 6000 }).toBe(prima);
    expect((await tabUrls(app)).filter((u) => u.includes(BLOCKED_HOST) || u === r.url)).toEqual([]);
  } finally {
    await r.close();
  }
});

test('#590 anche l\'assistente sulla pagina: NAVIGA verso un sito della lista non apre e la sua chat lo dice', async ({ app, shell, openTab, testServer }) => {
  await enableBlock(shell);
  const target = blockedUrl(testServer, '<!doctype html><meta charset="utf-8"><h1>X</h1>');
  // Sulle pagine interne i content script sono raggiungibili dal test (come in sidebar-filo-action).
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => !!window.SN_SIDEBAR && !!window.__filoSidebarTest, null, { timeout: 8000 });
  await page.evaluate(() => window.SN_SIDEBAR.open());
  const esito = await page.evaluate((u) => window.__filoSidebarTest.runFiloAction({ type: 'NAVIGA', url: u }), target);
  expect(esito).toBe(false);
  await expect(page.locator('.sn-sidebar-log').last()).toContainText(`${BLOCKED_HOST} è fra i siti bloccati`);
  expect((await tabUrls(app)).filter((u) => u.includes(BLOCKED_HOST))).toEqual([]);
});
