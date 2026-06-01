import { test, expect } from './fixtures/electron.mjs';

// FB1 — Modalità incognito.
//
// Due garanzie da verificare, entrambe asseriscono SUCCESSO (fallirebbero senza
// il fix):
//
//  1) Privacy dello storage filo://: dentro un contesto incognito le chiavi di
//     "memoria" (cronologia, salvati, costi, …) NON toccano il disco e NON sono
//     leggibili da disco; le chiavi di "config" (settings, …) restano leggibili
//     (passthrough). Ciò che l'incognito scrive vive solo in RAM e sparisce al
//     reset. Pilotiamo direttamente lo shim di storage nel main process.
//
//  2) UI/finestra: l'ingresso `openIncognito` apre una SECONDA finestra con un
//     TabManager incognito (partizione effimera) e la shell mostra il badge
//     "Incognito" con il tema dedicato.

test('incognito storage: memoria in RAM, config passthrough, disco intatto', async ({ app }) => {
  const out = await app.evaluate(async () => {
    // app.evaluate gira nel main process ma senza `require` in scope: lo shim
    // si auto-espone su globalThis quando NODE_ENV=test (vedi storage.js).
    const DiskStorage = globalThis.__filoStorage;

    // Seed su DISCO (contesto normale): una chiave config + una chiave memoria.
    await DiskStorage.set({ settings: { theme: 'dark', _probe: 'disk-settings' } });
    await DiskStorage.set({ aiHistory: ['real-entry'] });

    // Dentro incognito: leggi config (passthrough), leggi memoria (nascosta),
    // scrivi memoria (solo overlay) e rileggila (read-back dall'overlay).
    const incog = await DiskStorage.runIncognito(async () => {
      const s = await DiskStorage.get('settings');
      const h0 = await DiskStorage.get('aiHistory');
      await DiskStorage.set({ aiHistory: ['incognito-only'] });
      const h1 = await DiskStorage.get('aiHistory');
      // Anche una nuova chiave memoria scritta in incognito non deve persistere.
      await DiskStorage.set({ savedPages: [{ id: 'x', url: 'http://secret' }] });
      return {
        settingsProbe: s.settings?._probe,
        hiddenHistory: h0.aiHistory,
        overlayHistory: h1.aiHistory,
      };
    });

    // Fuori incognito: il disco (STATE in memoria, sorgente del file) è intatto.
    const afterHistory = (await DiskStorage.get('aiHistory')).aiHistory;
    const afterSaved = (await DiskStorage.get('savedPages')).savedPages;

    // Dopo il reset overlay, nessuna traccia dell'incognito.
    DiskStorage.resetIncognito();
    const resetHistory = await DiskStorage.runIncognito(async () => (await DiskStorage.get('aiHistory')).aiHistory);

    return { ...incog, afterHistory, afterSaved, resetHistory };
  });

  // Config ereditata dal disco anche in incognito.
  expect(out.settingsProbe).toBe('disk-settings');
  // Memoria su disco invisibile dall'incognito.
  expect(out.hiddenHistory).toBeUndefined();
  // Scrittura incognito visibile solo nell'overlay della stessa sessione.
  expect(out.overlayHistory).toEqual(['incognito-only']);
  // Il disco NON è stato toccato dalle scritture incognito.
  expect(out.afterHistory).toEqual(['real-entry']);
  expect(out.afterSaved).toBeUndefined();
  // Dopo il reset, una nuova sessione incognito non vede nulla della precedente
  // (e la memoria su disco resta comunque nascosta).
  expect(out.resetHistory).toBeUndefined();
});

test('incognito window: seconda finestra, TabManager effimero, badge visibile', async ({ app, shell }) => {
  // Ingresso reale: la voce "Nuova finestra incognito" del menu Impostazioni
  // chiama questa API del preload della shell.
  await shell.evaluate(() => window.filoShell.openIncognito());

  // Attendi che il main abbia creato la finestra incognito.
  const deadline = Date.now() + 15000;
  let info = null;
  while (Date.now() < deadline) {
    info = await app.evaluate(({ BrowserWindow }) => {
      const incog = BrowserWindow.getAllWindows().find((w) => w._filoIncognito);
      if (!incog) return null;
      const tabs = incog._filoTabs;
      return {
        count: BrowserWindow.getAllWindows().length,
        tabsIncognito: !!(tabs && tabs.incognito),
        partition: (tabs && tabs.partition) || null,
      };
    });
    if (info) break;
    await new Promise((r) => setTimeout(r, 150));
  }

  expect(info, 'la finestra incognito deve aprirsi').toBeTruthy();
  expect(info.count).toBeGreaterThanOrEqual(2); // finestra normale + incognito
  expect(info.tabsIncognito).toBe(true);
  expect(info.partition).toMatch(/^filo-incognito-/);

  // La shell incognito (filo://shell/shell.html?incognito=1) applica il tema e
  // mostra il badge.
  const incogShell = app.windows().find((p) => {
    try { return p.url().includes('incognito=1'); } catch (_) { return false; }
  });
  expect(incogShell, 'la Page della shell incognito deve esistere').toBeTruthy();
  await incogShell.waitForLoadState('domcontentloaded').catch(() => {});
  await incogShell.waitForFunction(
    () => document.documentElement.dataset.incognito === '1',
    null,
    { timeout: 8000 },
  );
  const badge = await incogShell.evaluate(() => {
    const el = document.getElementById('incognito-badge');
    if (!el) return { present: false };
    return {
      present: true,
      hidden: el.hidden,
      hasSvg: !!el.querySelector('svg'),
      text: (el.textContent || '').trim(),
    };
  });
  expect(badge.present).toBe(true);
  expect(badge.hidden).toBe(false);
  expect(badge.hasSvg).toBe(true);
  expect(badge.text).toContain('Incognito');
});
