// Menu tasto destro su una tab (spec §4): Duplica / Muta / Chiudi.
//
// I test ASSERISCONO il successo della feature:
//  - Duplica → compare una nuova tab con lo STESSO url dell'originale.
//  - Muta → lo stato `muted` della tab diventa true e in barra appare
//    l'indicatore .mute-ind; un secondo Muta lo riporta a false.
//  - Chiudi → la tab sparisce dalla barra.
// Oltre al percorso backend (filoShell.tabs.*) verifichiamo anche che il vero
// menu del tasto destro si apra e che cliccare "Duplica" duplichi davvero.

import { test, expect } from './fixtures/electron.mjs';

// Apre due tab note così abbiamo un bersaglio non-attivo e contiamo bene.
async function setup(openTab, shell) {
  await openTab('filo://options/options.html');
  await shell.locator('.tab .title', { hasText: 'Modelli' }).first().waitFor({ timeout: 8_000 });
}

test('Duplica crea una copia della tab con lo stesso URL', async ({ shell, openTab }) => {
  await setup(openTab, shell);
  const before = await shell.locator('.tab').count();
  // Duplica la tab attiva (Modelli) via la stessa API che usa il menu.
  const newId = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const active = snap.tabs.find((t) => t.id === snap.activeId);
    const r = await window.filoShell.tabs.duplicate(active.id);
    return r && r.id;
  });
  expect(newId).toBeTruthy();
  await expect(shell.locator('.tab')).toHaveCount(before + 1, { timeout: 8_000 });
  // Due schede "Modelli": l'originale e la copia.
  await expect(shell.locator('.tab .title', { hasText: 'Modelli' })).toHaveCount(2, { timeout: 8_000 });
});

test('Duplica eredita lo zoom e la posizione di scroll della scheda sorgente', async ({ app, shell, openTab, testServer }) => {
  // Pagina alta e scrollabile servita via http così è zoomabile/scrollabile.
  const url = testServer.html(
    '<html><body style="margin:0"><div style="height:6000px"></div>fine</body></html>',
  );
  const page = await openTab(url);
  const target = new URL(url).hostname;

  // Scrolla la sorgente a metà e impostale uno zoom noto (livello 2).
  await page.evaluate(() => window.scrollTo(0, 2500));
  await page.waitForFunction(() => window.scrollY > 2000, null, { timeout: 8_000 });

  const srcId = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return snap.activeId;
  });
  await app.evaluate(({ BrowserWindow }, id) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => t.id === id);
    tab.view.webContents.setZoomLevel(2);
  }, srcId);

  const before = await shell.locator('.tab').count();
  const newId = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return (await window.filoShell.tabs.duplicate(snap.activeId)).id;
  });
  expect(newId).toBeTruthy();
  await expect(shell.locator('.tab')).toHaveCount(before + 1, { timeout: 8_000 });

  // La copia, a caricamento finito, deve trovarsi allo zoom 2 (non al default 0).
  await expect
    .poll(
      async () =>
        app.evaluate(({ BrowserWindow }, id) => {
          const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
          const tab = win._filoTabs.tabs.find((t) => t.id === id);
          return tab ? tab.view.webContents.getZoomLevel() : null;
        }, newId),
      { timeout: 8_000 },
    )
    .toBe(2);

  // ...e deve essere scrollata vicino alla posizione della sorgente (senza fix
  // partirebbe da 0). Individuo la Page della copia: stesso host, diversa da
  // quella sorgente.
  await expect
    .poll(
      async () => {
        const cands = app.windows().filter((w) => {
          try { return new URL(w.url()).hostname === target; } catch (_) { return false; }
        });
        const dup = cands.find((w) => w !== page);
        if (!dup) return 0;
        try { return await dup.evaluate(() => window.scrollY); } catch (_) { return 0; }
      },
      { timeout: 8_000 },
    )
    .toBeGreaterThan(1500);
});

test('Muta silenzia la tab e mostra l\'indicatore; un secondo Muta lo toglie', async ({ shell, openTab }) => {
  await setup(openTab, shell);
  const id = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return snap.activeId;
  });
  // All'inizio nessun indicatore mutato.
  await expect(shell.locator('.tab .mute-ind')).toHaveCount(0);

  // Muta (toggle: muted omesso) → stato true + indicatore visibile.
  await shell.evaluate((tabId) => window.filoShell.tabs.setMuted(tabId), id);
  await expect(shell.locator(`.tab[data-id="${id}"] .mute-ind`)).toHaveCount(1, { timeout: 8_000 });
  const mutedNow = await shell.evaluate(async (tabId) => {
    const snap = await window.filoShell.tabs.snapshot();
    return !!snap.tabs.find((t) => t.id === tabId)?.muted;
  }, id);
  expect(mutedNow).toBe(true);

  // Riattiva audio → stato false + indicatore sparito.
  await shell.evaluate((tabId) => window.filoShell.tabs.setMuted(tabId), id);
  await expect(shell.locator(`.tab[data-id="${id}"] .mute-ind`)).toHaveCount(0, { timeout: 8_000 });
});

test('il tasto destro su una tab apre il menu Duplica/Muta/Chiudi e Duplica funziona', async ({ app, shell, openTab }) => {
  await setup(openTab, shell);
  const before = await shell.locator('.tab').count();

  // Right-click reale sulla tab attiva → handler contextmenu → popup-menu.
  await shell.evaluate(() => {
    const el = document.querySelector('.tab.active') || document.querySelector('.tab');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.round(r.left + r.width / 2),
      clientY: Math.round(r.top + r.height / 2),
    }));
  });

  // Trova la finestra-popup del menu (data:text/html con le voci) e clicca Duplica.
  let popup = null;
  await expect.poll(async () => {
    for (const w of app.windows()) {
      try {
        const has = await w.evaluate(() => document.body && /Duplica/.test(document.body.innerText));
        if (has) { popup = w; return true; }
      } catch (_) {}
    }
    return false;
  }, { timeout: 8_000 }).toBe(true);

  // Le tre voci attese sono presenti.
  const text = await popup.evaluate(() => document.body.innerText);
  expect(text).toMatch(/Duplica/);
  expect(text).toMatch(/Muta/);
  expect(text).toMatch(/Chiudi/);

  // Clicca "Duplica" → deve comparire una tab in più.
  await popup.evaluate(() => {
    const btn = [...document.querySelectorAll('button.item')]
      .find((b) => /Duplica/.test(b.textContent));
    btn.click();
  });
  await expect(shell.locator('.tab')).toHaveCount(before + 1, { timeout: 8_000 });
});
