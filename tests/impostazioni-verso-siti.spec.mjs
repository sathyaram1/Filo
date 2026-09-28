// #589 — quando un'impostazione cambia, il content script di un sito riceve il
// cambio (il tema si applica) ma non le chiavi dei servizi né le credenziali del
// proxy; la pagina filo:// accanto riceve l'oggetto intero. Si legge il messaggio
// DENTRO il mondo isolato dei content script, dove arriva davvero.

import { test, expect } from './fixtures/electron.mjs';

const CHIAVE = 'sk-or-v1-SPINTA-589-' + Date.now();
const PROXY = 'socks5://utente-{country}:parolasegreta589@gate.provider.example:7000';
// Il mondo isolato del preload (contextIsolation) è il 999 in Electron.
const MONDO_CONTENT_SCRIPT = 999;

async function nelContentScript(app, origine, codice) {
  return app.evaluate(async ({ webContents }, { origine, codice, mondo }) => {
    // L'ultima scheda aperta su quel sito: quelle delle prove precedenti possono esserci ancora.
    const wc = webContents.getAllWebContents()
      .filter((w) => !w.isDestroyed() && String(w.getURL()).startsWith(origine)).pop();
    if (!wc) throw new Error('scheda del mini server non trovata');
    return wc.executeJavaScriptInIsolatedWorld(mondo, [{ code: codice }]);
  }, { origine, codice, mondo: MONDO_CONTENT_SCRIPT });
}

test('un cambio di impostazioni arriva al sito senza chiavi né proxy, e intero alla pagina filo://', async ({ app, shell, openTab, testServer }) => {
  void shell; // boot finito: la semina qui sotto non corre col read-modify-write iniziale
  await app.evaluate(async (_e, { chiave, proxy }) => {
    const S = globalThis.__filoStorage;
    const cur = (await S.get('settings')).settings || {};
    await S.set({ settings: {
      ...cur,
      theme: 'light',
      apiKeys: { ...(cur.apiKeys || {}), openrouter: chiave },
      proxy: { ...(cur.proxy || {}), datacenter: proxy, residential: proxy },
    } });
  }, { chiave: CHIAVE, proxy: PROXY });

  const sito = await testServer.openReady(openTab, '<!doctype html><html><body><p>Una pagina qualunque.</p></body></html>');
  await sito.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => sito.evaluate(() => document.documentElement.dataset.snTheme)).toBe('light');

  await nelContentScript(app, testServer.origin, `
    globalThis.__spia589 = [];
    chrome.runtime.onMessage.addListener((m) => {
      if (m && m.type === SN_MSG.MSG.SETTINGS_UPDATED) globalThis.__spia589.push(JSON.stringify(m));
    });
    true;
  `);

  const interna = await openTab('filo://history/history.html');
  await interna.waitForFunction(() => !!(window.filo && window.filo.onBroadcast), null, { timeout: 8000 });
  await interna.evaluate(() => {
    window.__spia589 = [];
    window.filo.onBroadcast((m) => { if (m && m.type === 'settings_updated') window.__spia589.push(JSON.stringify(m)); });
  });

  // Il cambio passa dall'handler vero, come dalle Preferenze.
  await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    await globalThis.SN_HANDLE_MESSAGE({ type: MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }, { url: 'filo://preferences/preferences.html' });
  });

  // Il sito: il cambio arriva e si applica…
  await expect.poll(() => sito.evaluate(() => document.documentElement.dataset.snTheme), { timeout: 8000 }).toBe('dark');
  const ricevuti = await nelContentScript(app, testServer.origin, 'globalThis.__spia589');
  expect(ricevuti.length, 'il content script del sito deve ricevere il cambio').toBeGreaterThan(0);
  const ultimo = JSON.parse(ricevuti[ricevuti.length - 1]);
  expect(ultimo.settings.theme).toBe('dark');
  // …ma senza segreti.
  for (const m of ricevuti) {
    expect(m).not.toContain(CHIAVE);
    expect(m).not.toContain('parolasegreta589');
  }
  expect(ultimo.settings.apiKeys).toBeUndefined();
  expect(ultimo.settings.proxy).toBeUndefined();

  // Le letture dal content script seguono la stessa regola della spinta.
  const letture = await nelContentScript(app, testServer.origin, `
    (async () => {
      const get = await chrome.runtime.sendMessage({ type: SN_MSG.MSG.GET_SETTINGS });
      const st = await chrome.storage.local.get(null);
      return JSON.stringify({ get: get.settings, storage: st.settings });
    })()
  `);
  expect(letture).not.toContain(CHIAVE);
  expect(letture).not.toContain('parolasegreta589');
  expect(JSON.parse(letture).get.theme).toBe('dark');

  // Il registro ritagliato basta ancora al menu della dettatura del sito.
  const dettatura = await nelContentScript(app, testServer.origin,
    'JSON.stringify((SN_TTS.buildDictateItem().subItems || []).map((i) => i.label || ""))');
  expect(dettatura).toMatch(/✓ +Whisper/);
  expect(dettatura).toContain('Nemotron');

  // La pagina filo:// riceve l'oggetto intero: le Opzioni ci leggono le chiavi.
  await expect.poll(() => interna.evaluate(() => window.__spia589.length), { timeout: 8000 }).toBeGreaterThan(0);
  const interno = JSON.parse(await interna.evaluate(() => window.__spia589[window.__spia589.length - 1]));
  expect(interno.settings.theme).toBe('dark');
  expect(interno.settings.apiKeys.openrouter).toBe(CHIAVE);
  expect(interno.settings.proxy.datacenter).toBe(PROXY);
});

// Il confine vale per ogni cosa che passa, non solo per le impostazioni: la
// spinta porta ai siti solo i tipi che il loro content script ascolta, e da un
// sito si scrive solo ciò che quel content script scrive davvero.
test('a un sito non arriva l\'intervista di benvenuto, e da un sito non si riscrivono impostazioni né magazzino', async ({ app, shell, openTab, testServer }) => {
  void shell;
  const PROXY_SITO = 'socks5://ladro:pwd-del-sito-589@gate.attaccante.example:7000';
  await app.evaluate(async () => {
    await globalThis.__filoStorage.set({
      filo_memory: { PROFILO: 'Anna, MEMORIA-589' },
      filo_onboarding: { done: false, ticked: [], notice: 'x', thread: [{ role: 'user', text: 'mi chiamo Anna, INTERVISTA-589' }] },
    });
  });

  const sito = await testServer.openReady(openTab, '<!doctype html><html><body><p>Un sito.</p></body></html>');
  await sito.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await nelContentScript(app, testServer.origin, `
    globalThis.__spia589b = [];
    chrome.runtime.onMessage.addListener((m) => { try { globalThis.__spia589b.push(JSON.stringify(m)); } catch (_) {} });
    true;
  `);
  const interna = await openTab('filo://history/history.html');
  await interna.waitForFunction(() => !!(window.filo && window.filo.onBroadcast), null, { timeout: 8000 });
  await interna.evaluate(() => { window.__spia589b = []; window.filo.onBroadcast((m) => window.__spia589b.push(m && m.type)); });

  // L'intervista si salva (la home segna letta la sua riga) e si annuncia a tutte le schede.
  await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE(
    { type: globalThis.SN_MSG.MSG.FILO_ONBOARDING_NOTICE_SEEN }, { url: 'filo://dashboard/dashboard.html' },
  ));
  await expect.poll(() => interna.evaluate(() => window.__spia589b.includes('filo_onboarding_updated')), { timeout: 8000 }).toBe(true);
  // Una spinta che il sito ascolta, dopo: se arriva questa, l'altra aveva avuto tutto il tempo.
  await app.evaluate(async () => {
    await globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'light' } }, { url: 'filo://preferences/preferences.html' });
  });
  await expect.poll(() => nelContentScript(app, testServer.origin, 'globalThis.__spia589b.some((m) => m.includes("settings_updated"))'), { timeout: 8000 }).toBe(true);
  const alSito = await nelContentScript(app, testServer.origin, 'globalThis.__spia589b.join("\\n")');
  expect(alSito, 'l\'intervista di benvenuto è arrivata dentro la pagina di un sito').not.toContain('INTERVISTA-589');
  expect(alSito).not.toContain('filo_onboarding_updated');

  // Dal content script del sito: le scritture che il suo codice non fa sono rifiutate…
  const esiti = JSON.parse(await nelContentScript(app, testServer.origin, `
    (async () => {
      const MSG = SN_MSG.MSG;
      const proxy = await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: { proxy: { datacenter: ${JSON.stringify(PROXY_SITO)} } } });
      const tetto = await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: { monthlyLimitEur: 999999, security: { protectIpLeak: false } } });
      await chrome.storage.local.set({ filo_memory: { PROFILO: 'DETTATA-DAL-SITO' } });
      await chrome.storage.local.remove(['filo_memory']);
      const letta = await chrome.storage.local.get(['filo_memory', 'filo_onboarding', 'clipboardHistory']);
      const tutto = await chrome.storage.local.get(null);
      // …e quelle che fa davvero continuano a funzionare.
      const dettatura = await chrome.runtime.sendMessage({ type: MSG.UPDATE_SETTINGS, settings: { models: { transcribe_audio: 'whisper' } } });
      await chrome.storage.local.set({ sn_feedback_draft_text: 'bozza-589' });
      const bozza = await chrome.storage.local.get(['sn_feedback_draft_text']);
      return JSON.stringify({ proxy, tetto, letta, chiaviTutto: Object.keys(tutto), dettatura: dettatura && dettatura.ok, bozza: bozza.sn_feedback_draft_text });
    })()
  `));
  expect(esiti.proxy?.ok).toBe(false);
  expect(esiti.tetto?.ok).toBe(false);
  expect(JSON.stringify(esiti.letta)).not.toContain('MEMORIA-589');
  expect(JSON.stringify(esiti.letta)).not.toContain('INTERVISTA-589');
  expect(esiti.chiaviTutto).not.toContain('filo_memory');
  expect(esiti.dettatura, 'la scelta della dettatura dal menu di un sito deve continuare a salvarsi').toBe(true);
  expect(esiti.bozza, 'la bozza del feedback su un sito deve continuare a salvarsi').toBe('bozza-589');

  const vere = await app.evaluate(async () => {
    const r = await globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.GET_SETTINGS }, { url: 'filo://options/options.html' });
    const mem = (await globalThis.__filoStorage.get('filo_memory')).filo_memory;
    return { settings: r.settings, mem };
  });
  expect(JSON.stringify(vere.settings.proxy || null)).not.toContain('pwd-del-sito-589');
  expect(vere.settings.monthlyLimitEur).not.toBe(999999);
  expect(vere.settings.security.protectIpLeak).toBe(true);
  expect(vere.settings.models.transcribe_audio).toBe('whisper');
  expect(JSON.stringify(vere.mem)).toContain('MEMORIA-589');
});

// Chi riceve vale come Filo solo se lo è anche la scheda che lo contiene: un sito
// può aprire nella sua pagina un riquadro su un indirizzo di Filo.
test('una pagina di Filo incorporata da un sito riceve le impostazioni ritagliate', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(({ k, p }) => window.filoShell.message({
    type: 'update_settings', settings: { apiKeys: { openrouter: k }, proxy: { datacenter: p } },
  }), { k: CHIAVE, p: PROXY });
  await openTab('filo://options/options.html');
  await testServer.openReady(openTab,
    '<h1>sito</h1><iframe src="filo://newtab/"></iframe><iframe src="filo://asset/"></iframe>');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => /^https?:/.test(String(t.url || '')));
    return tab.view.webContents.mainFrame.framesInSubtree.filter((f) => String(f.url).startsWith('filo://')).length;
  }), { timeout: 8000 }).toBe(2);

  // Si guarda la consegna a ogni riquadro, con l'indirizzo della scheda che lo contiene.
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__riquadri589 = [];
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const proto = Object.getPrototypeOf(win.webContents.mainFrame);
    const send = proto.send;
    proto.send = function (ch, ...a) {
      if (ch === 'filo:broadcast' && a[0]?.type === 'settings_updated') {
        globalThis.__riquadri589.push({ url: String(this.url || ''), top: String(this.top?.url || ''), dump: JSON.stringify(a[0].settings ?? null) });
      }
      return send.call(this, ch, ...a);
    };
  });
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await expect.poll(() => app.evaluate(() => globalThis.__riquadri589.filter((c) => /^https?:/.test(c.top) && c.url.startsWith('filo://')).length), { timeout: 8000 })
    .toBe(2);

  const consegne = await app.evaluate(() => globalThis.__riquadri589);
  for (const c of consegne.filter((x) => /^https?:/.test(x.top))) {
    expect(c.dump, `la chiave è arrivata dentro la pagina del sito, nel riquadro ${c.url}`).not.toContain(CHIAVE);
    expect(c.dump, `il proxy è arrivato dentro la pagina del sito, nel riquadro ${c.url}`).not.toContain('parolasegreta589');
  }
  const scheda = consegne.find((c) => c.url === c.top && c.url.startsWith('filo://options'));
  expect(scheda?.dump, 'la scheda di Filo deve continuare a ricevere l\'oggetto intero').toContain(CHIAVE);
});

// Al sito serve sapere se Filo è spento lì, non dove altro l'utente l'ha spento.
test('a un sito arriva solo la voce dei siti esclusi che lo riguarda', async ({ app, shell, openTab, testServer }) => {
  const ALTRO = 'banca-dell-utente-589.example';
  await shell.evaluate((d) => window.filoShell.message({ type: 'update_settings', settings: { blocklist: [d] } }), ALTRO);
  const sito = await testServer.openReady(openTab, '<h1>sito qualunque</h1>');
  await sito.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await nelContentScript(app, testServer.origin, `
    globalThis.__esclusi589 = [];
    chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'settings_updated') globalThis.__esclusi589.push(JSON.stringify(m)); });
    true;
  `);
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await expect.poll(() => nelContentScript(app, testServer.origin, 'globalThis.__esclusi589.length'), { timeout: 8000 }).toBeGreaterThan(0);

  const visto = await nelContentScript(app, testServer.origin, `
    (async () => {
      const get = await chrome.runtime.sendMessage({ type: 'get_settings' });
      const st = await chrome.storage.local.get('settings');
      return JSON.stringify({ spinta: globalThis.__esclusi589, get: get.settings.blocklist, storage: st.settings.blocklist });
    })()
  `);
  expect(visto, 'l\'elenco dei siti esclusi è arrivato a un altro sito').not.toContain(ALTRO);
  expect(JSON.parse(visto).get).toEqual([]);

  const interno = await shell.evaluate(() => window.filoShell.message({ type: 'get_settings' }));
  expect(interno.settings.blocklist, 'le pagine di Filo vedono tutto l\'elenco').toEqual([ALTRO]);
});

test('sul sito escluso Filo resta spento', async ({ shell, openTab, testServer }) => {
  const host = new URL(testServer.origin).hostname;
  await shell.evaluate((d) => window.filoShell.message({ type: 'update_settings', settings: { blocklist: [d, 'altro-589.example'] } }), host);
  const web = await testServer.openReady(openTab, '<h1 style="height:300px">sito escluso</h1>');
  // Da escluso il codice di Filo non arriva mai a dirsi pronto: si lascia il tempo di montarsi.
  await web.waitForTimeout(1500);
  await web.locator('h1').click({ button: 'right' });
  await web.waitForTimeout(800);
  await expect(web.locator('.sn-menu'), 'sul sito escluso il menu di Filo si è aperto').toBeHidden();
});

// Anche le spinte senza dati passano dalla lista: l'avviso dei dati dal vivo
// (timer, promemoria) arriva alle pagine di Filo e non ai siti.
test('l\'avviso dei dati dal vivo arriva alle pagine di Filo e non ai siti', async ({ app, shell, openTab, testServer }) => {
  const sito = await testServer.openReady(openTab, '<!doctype html><html><body><p>Un sito.</p></body></html>');
  await sito.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await nelContentScript(app, testServer.origin, `
    globalThis.__spia589v = [];
    chrome.runtime.onMessage.addListener((m) => { globalThis.__spia589v.push(m && m.type); });
    true;
  `);
  const interna = await openTab('filo://history/history.html');
  await interna.waitForFunction(() => !!(window.filo && window.filo.onBroadcast), null, { timeout: 8000 });
  await interna.evaluate(() => { window.__spia589v = []; window.filo.onBroadcast((m) => window.__spia589v.push(m && m.type)); });

  await shell.evaluate(() => window.filoShell.message({ type: 'filo_add_timer', label: 'pasta', seconds: 600 }));
  await expect.poll(() => interna.evaluate(() => window.__spia589v.includes('filo_live_updated')), { timeout: 8000 }).toBe(true);
  // Una spinta che il sito ascolta, dopo: se arriva questa, l'altra aveva avuto tutto il tempo.
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await expect.poll(() => nelContentScript(app, testServer.origin, 'globalThis.__spia589v.includes("settings_updated")'), { timeout: 8000 }).toBe(true);
  expect(await nelContentScript(app, testServer.origin, 'globalThis.__spia589v'), 'l\'avviso dei dati dal vivo è arrivato al sito').not.toContain('filo_live_updated');
});

// Anche dentro una sezione ammessa passa solo il campo dichiarato: il prossimo
// segreto messo nella sezione della voce resta a casa, la velocità di lettura no.
test('un campo nuovo dentro una sezione ammessa non arriva al sito', async ({ app, shell, openTab, testServer }) => {
  const sito = await testServer.openReady(openTab, '<!doctype html><html><body><p>Un sito.</p></body></html>');
  await sito.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await nelContentScript(app, testServer.origin, `
    globalThis.__spia589c = [];
    chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'settings_updated') globalThis.__spia589c.push(m.settings); });
    true;
  `);
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings', settings: { tts: { rate: 1.3, chiaveServizioVoce: 'SEGRETO-DENTRO-LA-VOCE-589' } },
  }));
  await expect.poll(() => nelContentScript(app, testServer.origin, 'globalThis.__spia589c.length'), { timeout: 8000 }).toBeGreaterThan(0);
  const arrivate = await nelContentScript(app, testServer.origin, 'globalThis.__spia589c[globalThis.__spia589c.length - 1]');
  expect(arrivate.tts?.rate, 'la velocità di lettura deve arrivare al sito').toBe(1.3);
  expect(JSON.stringify(arrivate), 'un campo mai dichiarato è arrivato al sito').not.toContain('SEGRETO-DENTRO-LA-VOCE-589');
});

// Un avviso di sistema lo mostra solo la scheda in primo piano: il sito sullo
// sfondo non ne riceve il testo, quello davanti sì.
test('un avviso di sistema arriva al sito in primo piano e non a quello sullo sfondo', async ({ app, openTab, testServer }) => {
  const spia = `
    globalThis.__spia589t = [];
    chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'show_toast') globalThis.__spia589t.push(m.text); });
    true;
  `;
  const sfondo = await testServer.openReady(openTab, '<!doctype html><html><body><p>Sullo sfondo.</p></body></html>');
  await sfondo.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await nelContentScript(app, testServer.origin, spia);
  const davanti = testServer.origin.replace('127.0.0.1', 'localhost');
  const pagina = await openTab(testServer.html('<!doctype html><html><body><p>Davanti.</p></body></html>').replace('127.0.0.1', 'localhost'));
  await pagina.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await nelContentScript(app, davanti, spia);

  await app.evaluate(() => globalThis.SN_WALLET_MAIN.outOfCreditsNotice({ keySource: 'own' }));
  await expect.poll(() => nelContentScript(app, davanti, 'globalThis.__spia589t.length'), { timeout: 8000 }).toBe(1);
  expect(await nelContentScript(app, testServer.origin, 'globalThis.__spia589t'), 'l\'avviso è arrivato al sito sullo sfondo').toEqual([]);
});
