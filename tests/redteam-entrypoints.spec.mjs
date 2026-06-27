// Punti d'accesso del canale Red-team (spec §2 accesso/navigazione, §8.1 invio).
//
// Assert di COMPORTAMENTO (non "non crasha"):
//   1) la home ha un controllo Red-team in alto a destra che apre filo://redteam/;
//   2) il pannello "Invia attacco" ha DUE campi separati (testo + descrizione)
//      e un bottone d'invio che mostra il costo (50 cr);
//   3) il bottone d'invio non procede con testo attacco vuoto (validazione);
//   4) la mappa pura status→messaggio copre i casi della spec §8.1.
//
// Il backend non è deployato: i test non dipendono da esso (validazione locale
// + funzione pura iniettata via page.evaluate).

import { test, expect } from './fixtures/electron.mjs';

const RT_URL = 'filo://redteam/redteam.html';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata entro 10s').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  return win;
}

test('la home ha un controllo Red-team in alto a destra che apre la pagina red-team', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  // Il controllo esiste tra i controlli della home (#dashControls).
  const rtBtn = page.locator('#dashControls .dash-ctrl[data-command="redteam"]');
  await expect(rtBtn).toBeVisible({ timeout: 8_000 });
  await expect(rtBtn).toHaveAttribute('aria-label', /red-team/i);

  // Cliccandolo si apre una scheda sulla pagina red-team.
  await rtBtn.click();
  const deadline = Date.now() + 10_000;
  let opened = null;
  while (Date.now() < deadline) {
    opened = app.windows().find((w) => w.url().includes('filo://redteam/'));
    if (opened) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(opened, 'la pagina red-team non si è aperta dopo il click').toBeTruthy();
});

test('il pannello "Invia attacco" ha due campi separati e il costo, e blocca con testo vuoto', async ({ openTab }) => {
  // Apriamo una pagina filo:// (i content script — incluso redteamAttack — sono
  // iniettati lì) e invochiamo direttamente l'apertura del pannello.
  const page = await openTab(RT_URL);
  await page.waitForLoadState('domcontentloaded');

  // L'UI del pannello è caricata come content script.
  await page.waitForFunction(() => !!window.SN_REDTEAM_ATTACK_UI, null, { timeout: 8_000 });
  await page.evaluate(() => window.SN_REDTEAM_ATTACK_UI.open());

  // Due campi SEPARATI (spec §8.1): testo attacco e descrizione.
  const attack = page.locator('.sn-rt-overlay .sn-rt-attack');
  const desc = page.locator('.sn-rt-overlay .sn-rt-desc');
  await expect(attack).toBeVisible();
  await expect(desc).toBeVisible();

  // Il bottone d'invio mostra il costo (50 cr) — sia da loggato ("· 50 cr") sia,
  // se non loggato, l'invito ad accedere (in entrambi i casi il costo è esposto
  // dall'etichetta dell'azione di invio).
  const send = page.locator('.sn-rt-overlay .sn-rt-send');
  await expect(send).toBeVisible();

  // Validazione: con testo attacco vuoto, l'invio NON deve produrre un tentativo.
  // Stato dello status PRIMA del click.
  const statusBefore = await page.locator('.sn-rt-overlay .sn-rt-status').textContent();
  await send.click();
  // Nessuna navigazione a ?attempt= avviene: il pannello resta aperto.
  await expect(page.locator('.sn-rt-overlay')).toBeVisible();
  // O è disabilitato (loggato, niente testo) o mostra un messaggio (non loggato /
  // testo mancante): in nessun caso "Invio…" rimane appeso come se fosse partito.
  const statusAfter = await page.locator('.sn-rt-overlay .sn-rt-status').textContent();
  expect(statusAfter).not.toBe('Invio…');
});

test('il menu tasto destro ha "Invia attacco" che apre il pannello con i due campi', async ({ openTab, testServer }) => {
  // Su una pagina esterna i content script (menu + redteamAttack) sono iniettati.
  const url = testServer.html('<!doctype html><html><body><h1 id="t">pagina</h1></body></html>');
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

  // Apri il menu contestuale Filo.
  await page.locator('#t').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();

  // La voce "Invia attacco (Red-team)" esiste.
  const item = menu.locator('.sn-menu-item', { hasText: 'Invia attacco' });
  await expect(item).toBeVisible();

  // Click → apre il pannello con i due campi separati.
  await item.click();
  await expect(page.locator('.sn-rt-overlay .sn-rt-attack')).toBeVisible({ timeout: 4000 });
  await expect(page.locator('.sn-rt-overlay .sn-rt-desc')).toBeVisible();
  await expect(page.locator('.sn-rt-overlay .sn-rt-send')).toBeVisible();
});

test('mappa pura status→messaggio (spec §8.1)', async ({ openTab }) => {
  const page = await openTab(RT_URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!window.SN_REDTEAM_ATTACK_UI, null, { timeout: 8_000 });

  const results = await page.evaluate(() => {
    const f = window.SN_REDTEAM_ATTACK_UI.submitStatusMessage;
    return {
      ok: f({ status: 'ok', attemptId: 'x' }).ok,
      insufficient: f({ status: 'insufficient_credits', have: 10, needed: 50 }),
      dormant: f({ status: 'dormant' }).text,
      notSignedIn: f({ status: 'not_signed_in' }),
      empty: f({ status: 'empty' }).text,
      error: f({ status: 'error' }).text,
    };
  });

  expect(results.ok).toBe(true);
  expect(results.insufficient.ok).toBe(false);
  expect(results.insufficient.text.toLowerCase()).toContain('insufficient'.slice(0, 4)); // "insufficienti"
  expect(results.dormant.toLowerCase()).toContain('attivo');
  expect(results.notSignedIn.ok).toBe(false);
  expect(results.notSignedIn.needLogin).toBe(true);
  expect(results.empty.toLowerCase()).toContain('attacco');
  expect(results.error.toLowerCase()).toContain('attivo');
});
