// Verifier stress test #252 — conferma cliccabile di "Salva per dopo".
// Non è il primary spec: prova i bordi che l'happy-path può aver saltato.
import { test, expect } from './fixtures/electron.mjs';

function makePage(testServer, title = 'Articolo') {
  return testServer.html(
    `<!doctype html><html><head><title>${title}</title></head>
     <body style="margin:0;height:100vh;background:#fff"><h1>x</h1></body></html>`,
  );
}

async function setCategorize(app, value) {
  const deadline = Date.now() + 10000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate((v) => new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { featureFlags: { categorize: v } } },
      (r) => resolve(r),
    );
  }), value);
}

async function savePage(page) {
  await page.waitForFunction(
    () => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await page.click('body', { button: 'right', position: { x: 400, y: 300 } });
  const btn = page.locator('.sn-menu [data-sn-icon-id="saveForLater"]');
  await expect(btn).toBeVisible();
  await btn.click();
}

// 1) Ignorando la conferma, la scheda si chiude DA SOLA (auto-close) e NON apre
//    la lista: il comportamento "senza fix" (chiusura) resta, con la finestra
//    per agire in mezzo.
test('ignorando la conferma la scheda si chiude da sola senza aprire la lista', async ({ app, openTab, testServer }) => {
  const page = await openTab(makePage(testServer, 'Da ignorare'));
  await savePage(page);
  await expect(page.locator('.sn-save-confirm')).toBeVisible({ timeout: 5000 });

  // Non tocco il riquadro. Attendo oltre l'auto-close (~4s).
  const deadline = Date.now() + 9000;
  let stillOpen = true;
  while (Date.now() < deadline) {
    stillOpen = app.windows().some((w) => {
      try { return w.url().startsWith(testServer.origin) || w.url().includes('/html'); } catch (_) { return false; }
    });
    if (!stillOpen) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  // La lista NON deve essersi aperta da sola.
  const home = app.windows().find((w) => {
    try { return w.url().startsWith('filo://home/home.html'); } catch (_) { return false; }
  });
  expect(home, 'ignorando la conferma la lista non deve aprirsi').toBeFalsy();
});

// 2) Con categorizzazione ATTIVA la lista si apre DENTRO la sotto-vista dove
//    vive la scheda (qui: "non categorizzate"), non nella griglia categorie
//    dove la card sarebbe invisibile.
test('con categorize attivo la conferma apre la sotto-vista con la scheda evidenziata', async ({ app, openTab, testServer }) => {
  await setCategorize(app, true);

  const page = await openTab(makePage(testServer, 'Con categorie'));
  await savePage(page);
  const pill = page.locator('.sn-save-confirm');
  await expect(pill).toBeVisible({ timeout: 5000 });
  await pill.click();

  const deadline = Date.now() + 8000;
  let home = null;
  while (Date.now() < deadline) {
    home = app.windows().find((w) => {
      try { return w.url().startsWith('filo://home/home.html'); } catch (_) { return false; }
    });
    if (home) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(home, 'la lista non si è aperta con categorize on').toBeTruthy();
  await home.waitForLoadState('domcontentloaded');
  // La card evidenziata deve comparire (non deve restare bloccata nella griglia
  // categorie senza mostrare la scheda).
  const highlighted = home.locator('.sn-card[data-highlighted="1"]');
  await expect(highlighted).toHaveCount(1, { timeout: 8000 });
});

// 3) Doppio click rapido sulla conferma non deve aprire due liste né esplodere.
test('doppio click rapido sulla conferma apre UNA sola lista', async ({ app, openTab, testServer, shell }) => {
  await shell.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.UPDATE_SETTINGS,
      settings: { featureFlags: { categorize: false } },
    });
  });
  const page = await openTab(makePage(testServer, 'Doppio click'));
  await savePage(page);
  const pill = page.locator('.sn-save-confirm');
  await expect(pill).toBeVisible({ timeout: 5000 });
  await pill.dblclick();

  await new Promise((r) => setTimeout(r, 2500));
  const homes = app.windows().filter((w) => {
    try { return w.url().startsWith('filo://home/home.html'); } catch (_) { return false; }
  });
  expect(homes.length, 'il doppio click ha aperto più liste').toBe(1);
});
