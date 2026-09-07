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
// Questo controllo si fermava alla prima riga con «URL is not a constructor»:
// `new URL(...)` qui dentro pesca la costante `URL` di questo file, che è una
// stringa. Non ha mai guardato niente, e intanto il difetto che doveva
// sorvegliare c'era davvero. Adesso il modulo si carica come lo carica la
// pagina (si registra su globalThis) e le quattro strade sono asserzioni.
test('le frasi citate dentro un rilievo NON cambiano l\'esito del giro', async () => {
  await import('../src/shared/feedbackStats.js');
  const S = globalThis.SN_FEEDBACK_STATS;

  const CAPO = 'Verifica: 2 rilievi.\nIl verificatore corregge tutti i rilievi; poi un altro verificatore ricontrolla.\n';
  const atteso = [{ outcome: 'migliorabile', findings: 2 }];

  // Un giro con due rilievi che il verificatore corregge: «migliorabile», 2.
  const sano = `${CAPO}- [1] La riga della coda non si apre.\n- [0] Il bordo è freddo.`;
  expect(S.parseVerifications(sano)).toEqual(atteso);

  // Lo stesso giro, ma un rilievo CITA la frase che ferma il lavoro. Restava
  // «fermata (fail)», cioè un lavoro che aspetta l'owner e che non aspettava.
  const citaStop = `${CAPO}- [1] Quando il registro non risponde il lavoro si ferma e la scheda non lo dice.\n- [0] Il bordo è freddo.`;
  expect(S.parseVerifications(citaStop)).toEqual(atteso);

  // …uno che cita la frase storica del controllo non superato: diventava fail,
  // e i tre rilievi diventavano uno.
  const citaFail = 'Verifica: 3 rilievi.\nIl verificatore corregge tutti i rilievi; poi un altro verificatore ricontrolla.\n'
    + '- [1] Nelle note vecchie compare ancora «Controllo funzionalità NON superato»: la scheda lo conta due volte.';
  expect(S.parseVerifications(citaFail)).toEqual([{ outcome: 'migliorabile', findings: 3 }]);

  // …e uno i cui passi cominciano con la frase del pass: era la peggiore, il
  // giro diventava un pass a zero critiche e finiva nella fetta verde.
  const citaPass = `${CAPO}- [1] La nota di verifica compare due volte.\n`
    + 'Verifica superata appare anche nel turno dell\'utente: passi qui sotto.';
  expect(S.parseVerifications(citaPass)).toEqual(atteso);
  expect(S.verificationSummary(citaPass)).toMatchObject({ passed: false, critiche: 1, fail: 0 });

  // …e la nota che ferma davvero il lavoro resta una fermata.
  const fermata = 'Verifica: 2 rilievi.\nProvato: molte cose, e reggono.\n'
    + 'Il lavoro si ferma: c\'è un rilievo di livello 2 o 3 che non si può correggere da soli.\n- [2] Perde i dati.';
  expect(S.parseVerifications(fermata)).toEqual([{ outcome: 'fail', findings: 2 }]);
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
