// #504 — «Traduci la pagina» si chiede anche a Filo in chat: traduce, riprende, prende il testo arrivato dopo, torna
// all'originale. A parole «traduci» non torna mai indietro come farebbe l'icona su una pagina già tradotta, e Filo sa
// dire com'è andata. Lo stesso dall'Aiuto della pagina, e Alt+T senza selezione fa l'icona. Il fornitore finto antepone
// "IT " a ogni blocco, come in translate-page.spec.mjs.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';
import { paginaDellAiuto, conta } from './helpers/riquadri.mjs';
import { copertura } from './helpers/avvisoSito.mjs';

const ARTICOLO = `<!doctype html><html lang="en"><head><title>An English article</title></head>
<body style="font:16px sans-serif;padding:20px">
  <h1 id="head">A feed that keeps growing while you scroll it</h1>
  <div id="feed">
    <div id="r0">First row of the feed, written in English.</div>
    <div id="r1">Second row of the feed, written in English.</div>
  </div>
  <script>
    window.__addRows = (n) => {
      for (let i = 0; i < n; i++) {
        const d = document.createElement('div');
        d.id = 'later' + i;
        d.textContent = 'Row number ' + i + ' arrived after the translation was done.';
        document.getElementById('feed').appendChild(d);
      }
    };
  </script>
</body></html>`;

// Più richieste da ~3000 caratteri: serve allo stato «a metà».
const LUNGA = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">A very long English article about nothing in particular</h1>
  ${Array.from({ length: 40 }, (_, i) => '<p id="p' + i + '">Paragraph number ' + i + ' of the body text, deliberately long enough to take a meaningful share of the request budget so that the article needs several separate requests to be translated in full.</p>').join('\n  ')}
</body></html>`;

// `fallisceDopo`: richieste servite prima di dare un guasto di rete (-1 mai); `ritardo` fa durare ogni richiesta.
async function fornitoreFinto(app, { fallisceDopo = -1, ritardo = 0 } = {}) {
  await app.evaluate(async (_electron, { fallisceDopo, ritardo }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__filoChiamate = 0;
    globalThis.__filoBlocchi = 0;
    globalThis.__filoFallisceDopo = fallisceDopo;
    const prima = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const last = [...args.messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return prima(args);
      globalThis.__filoChiamate++;
      if (ritardo > 0) await new Promise((r) => setTimeout(r, ritardo));
      const cap = globalThis.__filoFallisceDopo;
      if (cap >= 0 && globalThis.__filoChiamate > cap) throw new Error('fetch failed');
      const APRE = '<<<TESTO_IN_PAGINA>>>\n';
      const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
      const i = prompt.indexOf(APRE);
      const fine = prompt.lastIndexOf(CHIUDE);
      const parti = (i >= 0 && fine > i ? prompt.slice(i + APRE.length, fine) : '').split(/\n?@@@SN_SEP@@@\n?/);
      globalThis.__filoBlocchi += parti.length;
      return { text: parti.map((p) => `IT ${p}`).join('\n@@@SN_SEP@@@\n'), provider: 'test', model: 'test-translate', usage: {} };
    };
  }, { fallisceDopo, ritardo });
}

// Come la chat della home: il mittente è la finestra, con l'indirizzo della home (zoom-chat.spec.mjs).
const chiedi = (app, action) =>
  app.evaluate(({ BrowserWindow }, { action }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    return globalThis.SN_EXECUTE_FILO_ACTION(action, { sender: { win, wc: win.webContents, url: 'filo://newtab/' } });
  }, { action });
// Quello che torna al modello dopo l'azione: da qui dice all'utente com'è andata.
const perIlModello = (app, action, res) => app.evaluate((_electron, { action, res }) => {
  const rq = process.mainModule.require;
  const O = rq(rq('node:path').join(process.cwd(), 'src/main/services/osservazioniPerModello.js'));
  return O.toolResultText({ action, res, rendered: null });
}, { action, res });
const traduci = (app) => chiedi(app, { type: 'TRADUCI_PAGINA' });
const originale = (app) => chiedi(app, { type: 'TRADUCI_PAGINA', originale: true });

const tradotti = (page) => page.evaluate(() => document.querySelectorAll('[data-sn-translated="1"]').length);
const doppi = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[data-sn-translated="1"]'))
  .filter((el) => /^IT\s+IT\s/.test(el.textContent || '')).length);
const blocchi = (app) => app.evaluate(() => globalThis.__filoBlocchi);

// Gli avvisi durano pochi secondi: si raccolgono man mano che compaiono.
const guardaAvvisi = (page) => page.evaluate(() => {
  window.__avvisi = [];
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) window.__avvisi.push(n.textContent || '');
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
});
const avvisi = (page) => page.evaluate(() => window.__avvisi || []);

test('«traducimi la pagina»: si traduce; chiesto di nuovo resta tradotta; «torna all\'originale» la rimette', async ({ app, openTab, testServer }) => {
  await fornitoreFinto(app);
  const page = await testServer.openReady(openTab, ARTICOLO);
  await guardaAvvisi(page);

  const r = await traduci(app);
  expect(r.executed).toBe(true);
  expect(r.output).toMatchObject({ traduzione: 'partita', come: 'pagina' });
  await expect(page.locator('#head')).toHaveText(/^IT A feed/, { timeout: 30000 });
  await expect(page.locator('#r1')).toHaveText(/^IT Second row/);
  await expect.poll(() => page.title(), { timeout: 30000 }).toMatch(/^IT /);
  // Sulla pagina gli stessi avvisi del clic: a che punto è, poi com'è finita.
  await expect.poll(async () => (await avvisi(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);
  await page.screenshot({ path: 'tests/.shots/traduci-pagina-chat-tradotta.png' }).catch(() => {});

  expect(await perIlModello(app, { type: 'TRADUCI_PAGINA' }, r)).toMatch(/^Traduzione della pagina partita/);

  // L'icona su una pagina tradotta torna all'originale; la frase no: Filo dice che è già fatto.
  await expect.poll(async () => (await traduci(app)).output.traduzione, { timeout: 30000 }).toBe('gia_tradotta');
  await expect(page.locator('#head')).toHaveText(/^IT A feed/);
  const gia = await traduci(app);
  expect(await perIlModello(app, { type: 'TRADUCI_PAGINA' }, gia)).toMatch(/^La pagina è già tradotta tutta/);

  const via = await originale(app);
  expect(via.executed).toBe(true);
  expect(via.output.traduzione).toBe('originale');
  await expect(page.locator('#head')).toHaveText('A feed that keeps growing while you scroll it');
  await expect(page.locator('#r1')).toHaveText('Second row of the feed, written in English.');
  expect(await tradotti(page)).toBe(0);

  const ancora = await originale(app);
  expect(ancora.executed).toBe(true);
  expect(ancora.output.traduzione).toBe('niente');
  expect(await perIlModello(app, { type: 'TRADUCI_PAGINA', originale: true }, ancora)).toMatch(/^La pagina non era tradotta/);
  await expect(page.locator('#head')).toHaveText('A feed that keeps growing while you scroll it');
});

test('«traduci anche il testo nuovo»: solo le righe arrivate dopo vanno al modello', async ({ app, openTab, testServer }) => {
  await fornitoreFinto(app);
  const page = await testServer.openReady(openTab, ARTICOLO);
  await traduci(app);
  await expect(page.locator('#r1')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(async () => (await traduci(app)).output.traduzione, { timeout: 30000 }).toBe('gia_tradotta');
  const pagati = await blocchi(app);

  await page.evaluate(() => window.__addRows(4));
  await expect(page.locator('#later3')).toHaveText(/^Row number 3 /);
  await expect.poll(async () => {
    const r = await traduci(app);
    return r.output.traduzione === 'partita' ? r.output.come : r.output.traduzione;
  }, { timeout: 15000 }).toBe('nuovo');

  for (const id of ['#later0', '#later3']) await expect(page.locator(id)).toHaveText(/^IT /, { timeout: 30000 });
  expect(await doppi(page)).toBe(0);
  expect(await blocchi(app) - pagati).toBe(4);
});

test('«riprendi la traduzione»: riparte da dove si era fermata e non ripaga la parte fatta', async ({ app, openTab, testServer }) => {
  test.setTimeout(120000);
  await fornitoreFinto(app, { fallisceDopo: 1 });
  const page = await testServer.openReady(openTab, LUNGA);
  await guardaAvvisi(page);
  await traduci(app);
  await expect.poll(async () => (await avvisi(page)).some((t) => t.startsWith('Traduzione interrotta')), { timeout: 30000 }).toBe(true);
  const prima = await tradotti(page);
  expect(prima).toBeGreaterThan(0);
  expect(prima).toBeLessThan(41);

  await app.evaluate(() => { globalThis.__filoFallisceDopo = -1; });
  const r = await traduci(app);
  expect(r.executed).toBe(true);
  expect(r.output).toMatchObject({ traduzione: 'partita', come: 'ripresa' });
  expect(r.output.mancanti).toBeGreaterThan(0);
  expect(r.output.di).toBeGreaterThan(r.output.mancanti);

  await expect.poll(() => tradotti(page), { timeout: 60000 }).toBe(41);
  for (const id of ['#head', '#p0', '#p39']) await expect(page.locator(id)).toHaveText(/^IT /);
  expect(await doppi(page)).toBe(0);
});

test('«torna all\'originale» mentre traduce: si ferma e la pagina resta com\'era', async ({ app, openTab, testServer }) => {
  await fornitoreFinto(app, { ritardo: 3000 });
  const page = await testServer.openReady(openTab, ARTICOLO);
  expect((await traduci(app)).output.traduzione).toBe('partita');
  expect((await traduci(app)).output.traduzione).toBe('in_corso');

  const via = await originale(app);
  expect(via.output.traduzione).toBe('fermata');
  // Le risposte già spedite tornano dopo, e non devono ritradurre la pagina.
  await page.waitForTimeout(4000);
  await expect(page.locator('#head')).toHaveText('A feed that keeps growing while you scroll it');
  expect(await tradotti(page)).toBe(0);
});

test('chiesto dalla home: si traduce l\'ultima pagina usata, e Filo dice quale, perché non è davanti', async ({ app, openTab, testServer }) => {
  await fornitoreFinto(app);
  const page = await testServer.openReady(openTab, ARTICOLO);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.openTab('filo://newtab/');
  });
  const r = await traduci(app);
  expect(r.output).toMatchObject({ traduzione: 'partita', dietro: true });
  await expect(page.locator('#head')).toHaveText(/^IT A feed/, { timeout: 30000 });
  expect(await perIlModello(app, { type: 'TRADUCI_PAGINA' }, r)).toContain('non quella che ha davanti');
});

test('sito dove l\'utente ha spento Filo: la chat non lo traduce, come non c\'è l\'icona', async ({ app, openTab, testServer }) => {
  await fornitoreFinto(app);
  const host = new URL(testServer.origin).hostname;
  await app.evaluate(async (_electron, host) => { await globalThis.SN_STORAGE.updateSettings({ blocklist: [host] }); }, host);
  const page = await testServer.openReady(openTab, ARTICOLO);
  const r = await traduci(app);
  expect(r.executed).toBe(false);
  expect(r.output.traduzione).toBe('spento');
  await page.waitForTimeout(500);
  await expect(page.locator('#head')).toHaveText('A feed that keeps growing while you scroll it');
  expect(await app.evaluate(() => globalThis.__filoChiamate)).toBe(0);
});

test('nessuna pagina web aperta: Filo lo dice, invece di dire fatto', async ({ app, shell }) => {
  await expect(shell.locator('body')).toBeVisible();
  const r = await traduci(app);
  expect(r.executed).toBe(false);
  expect(r.output.traduzione).toBe('no-page');
});

test('pagina coperta dall\'avviso di sito pericoloso: non si traduce finché l\'utente non sceglie, e Filo lo dice', async ({ app, openTab, testServer }) => {
  await fornitoreFinto(app);
  // Su http un modulo con la password fa comparire l'avviso sopra la scheda.
  const page = await openTab(testServer.html(`<!doctype html><html lang="en"><body>
    <h1 id="head">Sign in to your account</h1><form><input type="password" name="p"></form></body></html>`));
  await expect.poll(async () => (await copertura(app).catch(() => null))?.coperta === true, { timeout: 10_000 }).toBe(true);
  const r = await traduci(app);
  expect(r.executed).toBe(false);
  expect(r.output.traduzione).toBe('coperta');
  expect(await perIlModello(app, { type: 'TRADUCI_PAGINA' }, r)).toMatch(/^Non fatto: la pagina è coperta dall'avviso/);
  await page.waitForTimeout(500);
  await expect(page.locator('#head')).toHaveText('Sign in to your account');
  expect(await app.evaluate(() => globalThis.__filoChiamate)).toBe(0);
});

test('pagina che non risponde (senza Filo montato): Filo dice che non l\'ha fatto, non «fatto»', async ({ app, openTab, testServer }) => {
  await fornitoreFinto(app);
  const page = await testServer.openReady(openTab, ARTICOLO);
  // Come un visualizzatore interno o una pagina di sistema: la domanda alla pagina non arriva a nessuno.
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
    const vera = wc.send.bind(wc);
    wc.send = (canale, ...resto) => (canale === 'filo:traduci-pagina' ? undefined : vera(canale, ...resto));
  });
  const r = await traduci(app);
  expect(r.executed).toBe(false);
  expect(r.output.traduzione).toBe('muto');
  expect(await perIlModello(app, { type: 'TRADUCI_PAGINA' }, r)).toMatch(/^Non fatto: la pagina davanti non risponde/);
  await expect(page.locator('#head')).toHaveText('A feed that keeps growing while you scroll it');
});

// L'Aiuto della pagina con un modello finto che usa l'azione «translate_page» descritta nelle sue istruzioni.
async function aiutoFinto(app, pagina) {
  await app.evaluate(async (_electron, pagina) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({ models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash', [C.ACTIONS.HELP]: 'deepseek-flash' } });
    const P = globalThis.SN_PROVIDERS;
    const traduzione = P.completeWithFallback;
    globalThis.__aiutoIstruzioni = '';
    globalThis.__aiutoPagina = pagina;
    const risposta = async (args) => {
      const sistema = String((args.messages.find((m) => m.role === 'system') || {}).content || '');
      const base = { model: args.attempts[0].model, provider: args.attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
      if (!sistema.includes('# Protocollo di risposta')) return traduzione(args);
      globalThis.__aiutoIstruzioni = sistema;
      return { ...base, text: JSON.stringify({ action: 'page', page: globalThis.__aiutoPagina, text: 'Ci penso io.', status: 'done' }) };
    };
    P.completeWithFallback = risposta;
    P.streamCompleteWithFallback = risposta;
  }, pagina);
}

test('nell\'Aiuto della pagina «traducimi questa pagina» la traduce, e «torna all\'originale» la rimette', async ({ app, shell, openTab, testServer }) => {
  await fornitoreFinto(app);
  await aiutoFinto(app, { op: 'translate_page' });
  const page = await testServer.openReady(openTab, ARTICOLO);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, page);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  const scrivi = async (testo) => {
    await aiuto.fill('.sn-sidebar-input textarea', testo);
    await aiuto.press('.sn-sidebar-input textarea', 'Enter');
  };

  await scrivi('traducimi questa pagina');
  await expect(page.locator('#head')).toHaveText(/^IT A feed/, { timeout: 30_000 });
  await expect(page.locator('#r1')).toHaveText(/^IT Second row/);
  // Le istruzioni dell'Aiuto dicono come si chiede, e il diario dice com'è andata.
  expect(await app.evaluate(() => globalThis.__aiutoIstruzioni)).toContain('"translate_page"');
  await expect(aiuto.locator('.sn-sidebar')).toContainText('traduzione della pagina partita');
  await aiuto.screenshot({ path: 'tests/.shots/traduci-pagina-aiuto.png' }).catch(() => {});

  await app.evaluate(() => { globalThis.__aiutoPagina = { op: 'translate_page', originale: true }; });
  await scrivi('torna all\'originale');
  await expect(page.locator('#head')).toHaveText('A feed that keeps growing while you scroll it', { timeout: 15_000 });
  expect(await tradotti(page)).toBe(0);
  await expect(aiuto.locator('.sn-sidebar')).toContainText('pagina rimessa nella lingua originale');
});

// Il tasto vero, come lo manda il sistema: i tasti sintetici del test non passano dalle scorciatoie di Filo.
const premiAltT = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
  const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['alt'] });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['alt'] });
});

test('Alt+T senza selezione fa l\'icona Traduci: traduce la pagina, e di nuovo la rimette com\'era', async ({ app, openTab, testServer }) => {
  await fornitoreFinto(app);
  const page = await testServer.openReady(openTab, ARTICOLO);
  await guardaAvvisi(page);
  await page.locator('#r0').click();
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await premiAltT(app);
  await expect(page.locator('#head')).toHaveText(/^IT A feed/, { timeout: 30_000 });
  await expect(page.locator('#r1')).toHaveText(/^IT Second row/);
  await expect.poll(async () => (await avvisi(page)).includes('Pagina tradotta'), { timeout: 30_000 }).toBe(true);
  expect((await avvisi(page)).join(' | ')).not.toMatch(/selezion/i);

  await premiAltT(app);
  await expect(page.locator('#head')).toHaveText('A feed that keeps growing while you scroll it', { timeout: 15_000 });
  expect(await tradotti(page)).toBe(0);
});

// #504.2 — il riquadro incorporato (un video, un modulo, i commenti) non è la pagina: senza selezione il tasto va a chi lo
// ospita; con del testo scelto lì dentro traduce quello.
const RIQUADRO = `<!doctype html><html lang="en"><body style="margin:0;padding:16px;font:16px sans-serif">
  <button id="play">Play video</button> <span id="w">Comments are closed</span>
</body></html>`;
const conRiquadro = (src) => `<!doctype html><html lang="en"><head><title>Football era</title></head>
<body style="font:16px sans-serif;padding:20px">
  <h1 id="head">The end of an era in European football</h1>
  <p id="p1">First paragraph of the body text, long enough to be picked up.</p>
  <iframe id="embed" src="${src}" width="420" height="120" style="border:1px solid #333"></iframe>
</body></html>`;

test('Alt+T senza selezione dopo un clic nel riquadro incorporato traduce la pagina che lo ospita; con del testo scelto lì traduce quello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await fornitoreFinto(app);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ models: { [globalThis.SN_CONST.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash', [globalThis.SN_CONST.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash' } });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = { ...orig, streamComplete: async ({ onDelta }) => { onDelta('I commenti sono chiusi.'); return { text: 'I commenti sono chiusi.', usage: {} }; } };
  });
  const page = await testServer.openReady(openTab, conRiquadro(testServer.html(RIQUADRO)));
  await guardaAvvisi(page);
  const riquadro = page.frameLocator('#embed');

  // Con il testo scelto nel riquadro (doppio clic vero, come lo manda il sistema): la risposta su quello, e la pagina resta com'è.
  await expect(riquadro.locator('#w')).toBeVisible();
  await page.waitForTimeout(500);
  const box = await riquadro.locator('#w').boundingBox();
  await app.evaluate(({ BrowserWindow }, { x, y }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
    wc.sendInputEvent({ type: 'mouseMove', x, y });
    for (const c of [1, 2]) {
      wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: c });
      wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: c });
    }
  }, { x: Math.round(box.x + 8), y: Math.round(box.y + box.height / 2) });
  await expect.poll(() => page.frames().find((f) => f !== page.mainFrame()).evaluate(() => String(getSelection()).trim())).not.toBe('');
  await premiAltT(app);
  await expect.poll(() => conta(app, page, '.sn-popup'), { timeout: 15_000 }).toBe(1);
  await page.waitForTimeout(800);
  await expect(page.locator('#head')).toHaveText('The end of an era in European football');
  expect(await app.evaluate(() => globalThis.__filoChiamate)).toBe(0);
  await page.keyboard.press('Escape');

  // Senza selezione, dopo il clic su «play»: si traduce la pagina, senza l'avviso della selezione mancante.
  await riquadro.locator('#play').click();
  await page.frames().find((f) => f !== page.mainFrame()).evaluate(() => getSelection().removeAllRanges());
  await page.evaluate(() => getSelection().removeAllRanges());
  await premiAltT(app);
  await expect(page.locator('#head')).toHaveText(/^IT The end of an era/, { timeout: 30_000 });
  await expect(page.locator('#p1')).toHaveText(/^IT First paragraph/);
  expect((await avvisi(page)).join(' | ')).not.toMatch(/selezion/i);
  await page.screenshot({ path: 'tests/.shots/traduci-pagina-alt-t-riquadro.png' }).catch(() => {});

  // Di nuovo dal riquadro: come l'icona, la rimette com'era.
  await riquadro.locator('#play').click();
  await premiAltT(app);
  await expect(page.locator('#head')).toHaveText('The end of an era in European football', { timeout: 15_000 });
});

test('Alt+T senza selezione dopo un clic in un riquadro di un altro sito (il video incorporato) traduce la pagina che lo ospita', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await fornitoreFinto(app);
  const page = await testServer.openReady(openTab, conRiquadro(testServer.html(RIQUADRO, { pubblico: true })));
  await guardaAvvisi(page);
  const riquadro = page.frameLocator('#embed');
  await riquadro.locator('#play').click();
  await page.evaluate(() => getSelection().removeAllRanges());
  await premiAltT(app);
  await expect(page.locator('#head')).toHaveText(/^IT The end of an era/, { timeout: 30_000 });
  await expect(page.locator('#p1')).toHaveText(/^IT First paragraph/);
  expect((await avvisi(page)).join(' | ')).not.toMatch(/selezion/i);
});

// #504.7 — il video viene da un sito dove l'utente ha spento Filo: lì Filo tace, ma la pagina che lo ospita è accesa.
test('Alt+T senza selezione dopo un clic nel video di un sito dove Filo è spento traduce la pagina che lo ospita', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await fornitoreFinto(app);
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ blocklist: ['sito-pubblico.test'] }); });
  const page = await testServer.openReady(openTab, conRiquadro(testServer.html(RIQUADRO, { pubblico: true })));
  await guardaAvvisi(page);
  const riquadro = page.frameLocator('#embed');
  await riquadro.locator('#play').click();
  await page.waitForTimeout(300);
  await page.evaluate(() => getSelection().removeAllRanges());
  await premiAltT(app);
  await expect(page.locator('#head')).toHaveText(/^IT The end of an era/, { timeout: 30_000 });
  await expect(page.locator('#p1')).toHaveText(/^IT First paragraph/);
  // Nel video Filo resta spento: niente tradotto lì dentro.
  await expect(riquadro.locator('#w')).toHaveText('Comments are closed');
  expect((await avvisi(page)).join(' | ')).not.toMatch(/selezion/i);
});

// #504.7 — con la risposta di una traduzione aperta la tastiera sta nei riquadri di Filo sopra il sito: senza selezione
// il tasto arriva alla pagina passando dallo strato, e la risposta resta aperta.
test('Alt+T senza selezione con la risposta di una traduzione aperta traduce la pagina sotto', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await fornitoreFinto(app);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ models: { [globalThis.SN_CONST.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash', [globalThis.SN_CONST.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash' } });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = { ...orig, streamComplete: async ({ onDelta }) => { onDelta('Un feed che cresce.'); return { text: 'Un feed che cresce.', usage: {} }; } };
  });
  const page = await testServer.openReady(openTab, ARTICOLO);
  await page.locator('#r0').dblclick();
  await premiAltT(app);
  await expect.poll(() => conta(app, page, '.sn-popup'), { timeout: 15_000 }).toBe(1);
  expect(await app.evaluate(() => globalThis.__filoChiamate)).toBe(0);

  // La tastiera nella casella della risposta, e niente scelto da nessuna parte.
  await clicca(app, page, '.sn-popup-input');
  await page.evaluate(() => getSelection().removeAllRanges());
  const strato = await tastieraDi(app, page);
  await strato.evaluate(() => getSelection().removeAllRanges());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    return !!tm.riquadri.conTastiera(tm.tabs.find((t) => t.id === tm.activeId).view.webContents);
  }), { message: 'la tastiera non è nei riquadri sopra il sito' }).toBe(true);

  // Il tasto vero, dove sta la tastiera: nello strato.
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    const wc = tm.riquadri.conTastiera(tm.tabs.find((t) => t.id === tm.activeId).view.webContents);
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['alt'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['alt'] });
  });
  await expect(page.locator('#head')).toHaveText(/^IT A feed/, { timeout: 30_000 });
  await expect(page.locator('#r1')).toHaveText(/^IT Second row/);
  expect(await conta(app, page, '.sn-popup')).toBe(1);
  expect(await conta(app, page, '.sn-toast')).toBe(0);
  await page.screenshot({ path: 'tests/.shots/traduci-pagina-alt-t-strato.png' }).catch(() => {});
});

// #504.2 — «apri … e traducilo» in una frase: la chat apre la scheda e chiede subito la traduzione, mentre il sito sta
// ancora arrivando. Un sito lento a rispondere, o a finire di mandare la pagina, non è una pagina che «non risponde».
async function sitoLento(use) {
  const server = createServer((req, res) => {
    const pagina = `<!doctype html><html lang="en"><head><title>A slow English site</title></head><body style="font:16px sans-serif;padding:20px">
  <h1 id="head">A slow English site that takes its time</h1>`;
    const resto = '<p id="p1">The rest of the article arrives a few seconds later.</p></body></html>';
    // Oltre l'attesa dell'apertura (5 s) e quella della domanda alla pagina messe in fila.
    if (req.url.startsWith('/primo-byte')) {
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(pagina + resto); }, 11000);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.write(pagina);
    if (req.url.startsWith('/subito')) res.end(resto);
    else setTimeout(() => res.end(resto), 10000);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { await use(`http://127.0.0.1:${server.address().port}`); } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
}

for (const [come, percorso] of [
  ['risponde subito', '/subito'],
  ['finisce di mandare la pagina dopo dieci secondi', '/corpo'],
  ['risponde dopo undici secondi', '/primo-byte'],
]) {
  test(`«apri … e traducilo» dalla chat della home, su un sito che ${come}: la pagina si traduce`, async ({ app, shell }) => {
    test.setTimeout(90_000);
    await fornitoreFinto(app);
    await expect(shell.locator('body')).toBeVisible();
    await sitoLento(async (origine) => {
      const url = `${origine}${percorso}`;
      const aperta = await chiedi(app, { type: 'NAVIGA', url });
      expect(aperta.executed).toBe(true);
      const r = await traduci(app);
      expect(r.output).toMatchObject({ traduzione: 'partita' });
      expect(r.executed).toBe(true);
      let page = null;
      await expect.poll(() => Boolean(page = app.windows().find((w) => w.url().startsWith(origine))), { timeout: 10_000 }).toBe(true);
      await expect(page.locator('#head')).toHaveText(/^IT A slow English site/, { timeout: 30_000 });
      await expect(page.locator('#p1')).toHaveText(/^IT The rest/, { timeout: 30_000 });
    });
  });
}
