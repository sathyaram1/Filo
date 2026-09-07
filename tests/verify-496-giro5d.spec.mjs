// #496 giro 5 — quarta tornata: ricerca attiva + discesa a una segnalazione,
// e le frasi di verifica riconosciute dentro la prosa di un rilievo.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ORA = new Date();
const iso = (g) => new Date(ORA.getTime() - g * 86400000).toISOString();
const TURNO = "\n--- Aggiornamento dell'agente del 1/1/2026 ---\n";

const fb = (o) => ({
  _id: o.id, seq: o.seq, subSeq: 0, name: o.name || o.id, text: `Segnalazione ${o.id}`,
  clientId: 'utente-esterno-1', createdAt: o.at,
  status: o.status || 'todo', notes: o.notes || '', images: [], priority: 0, _updateTime: 't1',
});

async function pronta(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
}

// ── Le frasi di verifica dentro la prosa di un rilievo ─────────────────────
// Il giro 4 ha chiuso la porta dei turni dell'UTENTE. Restano le frasi che il
// verificatore stesso scrive DENTRO un rilievo, nello stesso turno d'agente:
// due dei riconoscitori non pretendono che la frase apra la riga.
test('le frasi citate dentro un rilievo cambiano l\'esito del giro', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/shared/feedbackStats.js', import.meta.url), 'utf8');
  const g = {};
  new Function('global', src)(g);
  const S = g.SN_FEEDBACK_STATS;

  // Un giro con due rilievi che il verificatore corregge: «migliorabile», 2.
  const sano = 'Verifica: 2 rilievi.\nIl verificatore corregge tutti i rilievi; poi un altro verificatore ricontrolla.\n'
    + '[1] La riga della coda non si apre.\n[0] Il bordo è freddo.';
  console.log('SANO   :', JSON.stringify(S.parseVerifications(sano)));

  // Lo stesso giro, ma un rilievo CITA la frase che ferma il lavoro.
  const citaStop = 'Verifica: 2 rilievi.\nIl verificatore corregge tutti i rilievi; poi un altro verificatore ricontrolla.\n'
    + '[1] Quando il registro non risponde il lavoro si ferma e la scheda non lo dice.\n[0] Il bordo è freddo.';
  console.log('CITA-STOP:', JSON.stringify(S.parseVerifications(citaStop)));

  // …e uno che cita la frase storica del controllo non superato.
  const citaFail = 'Verifica: 3 rilievi.\nIl verificatore corregge tutti i rilievi; poi un altro verificatore ricontrolla.\n'
    + '[1] Nelle note vecchie compare ancora «Controllo funzionalità NON superato»: la scheda lo conta due volte.';
  console.log('CITA-FAIL:', JSON.stringify(S.parseVerifications(citaFail)));

  // …e un rilievo i cui passi cominciano con la frase del pass.
  const citaPass = 'Verifica: 2 rilievi.\nIl verificatore corregge tutti i rilievi; poi un altro verificatore ricontrolla.\n'
    + '[1] La nota di verifica compare due volte.\n'
    + 'Verifica superata appare anche nel turno dell\'utente: passi qui sotto.';
  console.log('CITA-PASS:', JSON.stringify(S.parseVerifications(citaPass)));
  console.log('CITA-PASS riassunto:', JSON.stringify(S.verificationSummary(citaPass)));
});

// ── Ricerca attiva + discesa dal numero alla segnalazione ──────────────────
test('con la ricerca attiva, dal numero si arriva alla segnalazione', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 's1', seq: 1, at: iso(1), status: 'todo' }),
    fb({ id: 's2', seq: 2, at: iso(1), status: 'done' }),
  ]);
  // Ricerca attiva sulla colonna di sinistra.
  await page.evaluate(() => window.__mgTest.runSearch('segnalazione'));
  await page.waitForTimeout(500);
  console.log('ricerca attiva?', await page.evaluate(() => window.__mgTest.isSearchMode()));

  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.locator('#mgStTileRicevuti').click();
  await page.locator('#mgStDrawer .mg-st-row[data-row="todo"]').click();
  await page.waitForTimeout(150);
  await page.locator('#mgStDrawer .mg-st-item[data-id="s1"]').click();
  await page.waitForTimeout(400);
  console.log('pannello dettaglio visibile?', await page.locator('#mgDetail').isVisible());
  console.log('scheda attiva:', await page.evaluate(() => {
    const t = document.querySelector('.mg-tab--active');
    return t ? t.textContent.trim() : '?';
  }));
  console.log('ricerca ancora attiva?', await page.evaluate(() => window.__mgTest.isSearchMode()));
  console.log('voci in lista:', await page.locator('#mgList .mg-item').count());
  await page.screenshot({ path: 'tests/.shots/496-g5-ricerca.png', fullPage: false });
});
