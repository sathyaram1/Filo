// VERIFIER #396 — Bacheca senza rete deve DIRE l'errore, non mentire "nessun
// miglioramento". Test black-box scritto dal verificatore (indipendente dal fix):
// riproduce esattamente la lamentela dell'utente.
//
// Sintomo: offline, la Bacheca mostra "Caricamento…" e poi "Nessun miglioramento
// da verificare per ora." — identico a quando davvero non c'è nulla. Deve invece
// mostrare uno stato d'errore comprensibile (in italiano, NON "Failed to fetch")
// con un tasto per riprovare, e il retry deve funzionare sul posto.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://board/board.html';

const SHIPPED = {
  _id: 'fb-verify-396',
  name: 'Un miglioramento davvero rilasciato',
  status: 'done',
  priority: 3,
  resolvedInVersion: '0.2.71',
  seq: 396, subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-06-20T10:00:00Z',
  votes: {},
};

async function ready(page) {
  await page.waitForFunction(
    () => window.__boardTest && window.SN_FEEDBACK && window.SN_MANAGE_REVIEW,
    null, { timeout: 15_000 },
  );
  // Attendi che il caricamento live iniziale sia finito (loader nascosto).
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 15_000 });
}

test('offline: la Bacheca mostra lo stato d\'errore con Riprova, NON "nessun miglioramento"', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await ready(page);

  // Simula la rete assente: FB.list rigetta con l'errore che il fetch del
  // renderer Chromium lancia offline. Poi rilancia il caricamento reale.
  await page.evaluate(({ ver }) => {
    window.__boardTest.setReleasedVersion(ver);
    window.__boardTest.setList(() => Promise.reject(new TypeError('Failed to fetch')));
  }, { ver: '0.2.71' });
  await page.evaluate(() => window.__boardTest.reload());

  // 1) Lo stato d'errore compare (distinto dal vuoto).
  const err = page.locator('#bdError');
  await expect(err).toBeVisible({ timeout: 10_000 });

  // 2) NON deve fingere "nessun miglioramento": il messaggio del vuoto resta nascosto.
  await expect(page.locator('#bdEmpty')).toBeHidden();

  // 3) Il messaggio parla di connessione/riprova, in italiano, e NON mostra il
  //    grezzo "Failed to fetch".
  const msg = (await page.locator('#bdErrorMsg').textContent() || '').trim();
  expect(msg.length, 'messaggio d\'errore vuoto').toBeGreaterThan(0);
  expect(msg.toLowerCase()).not.toContain('failed to fetch');
  expect(msg.toLowerCase()).toMatch(/connession|riprova|rete/);

  // 4) Il tasto Riprova esiste ed è abilitato.
  const retry = page.locator('#bdRetry');
  await expect(retry).toBeVisible();
  await expect(retry).toBeEnabled();

  // 5) Riprova FUNZIONA sul posto: la rete torna, FB.list risolve → i
  //    miglioramenti compaiono senza dover chiudere/riaprire la pagina.
  await page.evaluate(({ item }) => {
    window.__boardTest.setList(() => Promise.resolve([item]));
  }, { item: SHIPPED });
  await retry.click();

  await expect(page.locator('#bdError')).toBeHidden({ timeout: 10_000 });
  await expect(page.locator('.bd-card')).toHaveCount(1);
  await expect(page.locator('.bd-card-title')).toContainText('Un miglioramento davvero rilasciato');
});
