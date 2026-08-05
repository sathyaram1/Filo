// Cronologia (filo://archive): con molte schede archiviate nello stesso giorno
// la riga del giorno deve restare USABILE COL SOLO MOUSE e LEGGIBILE.
//
// Bug (#394): tutte le schede di un giorno stavano su una riga che non va a
// capo, con scrollbar nascosta e nessun handler rotellina → le eccedenti erano
// irraggiungibili col mouse; per di più le chip si comprimevano a un quadratino
// col titolo troncato a una lettera ("S…").
//
// Questo spec ASSERISCE il SUCCESSO, non l'assenza di un errore:
//   1) le chip restano LEGGIBILI (larghezza >= min-width, non un quadratino);
//   2) la rotellina VERTICALE del mouse scrolla la riga in orizzontale
//      (parità con la barra delle tab in alto), così l'ultima scheda si
//      raggiunge col solo mouse.
// Senza il fix entrambi gli assert diventano rossi (min-width 46px → chip
// minuscola; nessun handler wheel → scrollLeft resta 0).

import { test, expect } from './fixtures/electron.mjs';

const N = 30; // molte schede nello stesso giorno (auto-archiviazione ≈ normalità)

async function seedArchivedTabs(app, n) {
  await app.evaluate(async (_ev, count) => {
    const Archive = globalThis.SN_ARCHIVED_TABS;
    const now = new Date().toISOString();
    for (let i = 0; i < count; i++) {
      await Archive.archive({
        url: `https://esempio.test/pagina-${i}`,
        title: `Sito Numero ${String(i).padStart(2, '0')} con un titolo lungo`,
        closedAt: now,
      });
    }
  }, n);
}

test('archivio: molte schede in un giorno restano leggibili e raggiungibili col mouse', async ({ app, openTab }) => {
  await seedArchivedTabs(app, N);

  const archive = await openTab('filo://archive/archive.html');
  await archive.waitForLoadState('domcontentloaded');

  const row = archive.locator('.arc-tabs').first();
  await expect(row).toBeVisible({ timeout: 8_000 });

  // Tutte e 30 le schede del giorno sono nella stessa riga.
  await expect(archive.locator('.arc-tabs .arc-tab')).toHaveCount(N);

  // (1) LEGGIBILITÀ: la prima chip è larga almeno quanto il min-width (132px),
  // non un quadratino da una lettera. Senza il fix (min-width 46px) è rossa.
  const chipWidth = await archive.locator('.arc-tab').first().evaluate((el) => el.getBoundingClientRect().width);
  expect(chipWidth).toBeGreaterThanOrEqual(130);

  // C'è davvero overflow orizzontale (altrimenti il test non proverebbe nulla).
  const overflow = await row.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeGreaterThan(0);

  // (2) ROTELLINA VERTICALE → SCROLL ORIZZONTALE. Partiamo da 0, mandiamo un
  // wheel con deltaY positivo sulla riga e la posizione orizzontale avanza.
  const movedRight = await row.evaluate((el) => {
    el.scrollLeft = 0;
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true, cancelable: true }));
    return el.scrollLeft;
  });
  expect(movedRight).toBeGreaterThan(0);

  // La rotellina raggiunge il FONDO della riga: scrollando a ripetizione si
  // arriva all'ultima scheda (scrollLeft ≈ max). Prova che l'ultima è davvero
  // raggiungibile col solo mouse.
  const atEnd = await row.evaluate((el) => {
    for (let i = 0; i < 60; i++) {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true, cancelable: true }));
    }
    const max = el.scrollWidth - el.clientWidth;
    return el.scrollLeft >= max - 2;
  });
  expect(atEnd).toBe(true);

  // L'ultima chip della riga (in fondo allo scroll) ora è dentro la viewport
  // della riga: prova che l'ultima scheda è davvero raggiungibile col mouse.
  const last = archive.locator('.arc-tabs .arc-tab').last();
  const lastReachable = await last.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const rowRect = el.closest('.arc-tabs').getBoundingClientRect();
    return r.left >= rowRect.left - 1 && r.right <= rowRect.right + 1;
  });
  expect(lastReachable).toBe(true);
});
