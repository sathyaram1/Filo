// #495 — la regola "nessun numero finché il dato non c'è" sulle DUE superfici
// gemelle (gestione e pagina dei feedback).
//
// La dashboard di gestione la rispetta: caricamento fallito → le schede restano
// col solo nome. Qui si guarda se la gemella fa lo stesso.

import { test, expect } from './fixtures/electron.mjs';

// A ── Gestione: caricamento fallito, poi l'owner clicca in giro.
test('#495/vfx3 — gestione: caricamento fallito → nessun numero, nemmeno cambiando scheda', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());

  // Nessun dato è mai arrivato in questo ambiente (nessun Firestore).
  for (const t of ['queue', 'resolved', 'archived', 'inbox']) {
    await page.evaluate((x) => window.__mgTest.setTab(x), t);
  }
  const testi = await page.locator('.mg-tab[data-tab]').allInnerTexts();
  for (const t of testi) expect(t, `scheda "${t}"`).not.toMatch(/\(\d/);
});

// B ── Gemella: stessa situazione sulla pagina dei feedback.
test('#495/vfx3 — feedback: caricamento fallito → le sezioni non devono dire (0)', async ({ openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => typeof SN_FEEDBACK !== 'undefined' && window.__fbTest);

  // Caricamento fallito: è lo stato in cui la pagina si trova offline. In
  // questo ambiente non c'è rete, quindi ci arriva da sola — la si aspetta
  // dal tasto "Riprova" che compare solo su quel ramo.
  await expect(page.locator('.fb-load-retry')).toBeVisible({ timeout: 30000 });

  const primaDelClick = await page.locator('[data-tab]').allInnerTexts();
  console.log('DOPO IL FALLIMENTO:', JSON.stringify(primaDelClick));

  // L'utente fa la cosa più naturale del mondo: prova un'altra sezione.
  await page.locator('[data-tab="todo"]').click();
  await page.waitForTimeout(200);
  const dopoIlClick = await page.locator('[data-tab]').allInnerTexts();
  console.log('DOPO IL CLICK:', JSON.stringify(dopoIlClick));

  for (const t of dopoIlClick) {
    expect(t, `sezione "${t}" dopo un caricamento fallito`).not.toMatch(/\(0\)/);
  }
});
