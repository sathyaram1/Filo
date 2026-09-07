// Scheda «Statistiche feedback» (#496), correzioni del secondo giro.
//
// Cosa si prova qui, in linguaggio di chi guarda:
//   - la scheda lasciata aperta si accorge dei feedback che arrivano e di
//     quelli che spariscono, non resta la fotografia di quando l'hai aperta;
//   - il tasto destro offre le azioni di quel punto della scheda;
//   - il grafico degli arrivi non promette periodi che non sono ancora
//     successi;
//   - la finestra personalizzata senza date dice cosa stai guardando invece di
//     dare dell'errore a dei numeri giusti, e le date scelte si rileggono col
//     mese a parole.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ORA = new Date();
const iso = (g) => new Date(ORA.getTime() - g * 86400000).toISOString();
const PASS = 'Verifica superata. Provato tutto.';
const TURNO = "\n--- Aggiornamento dell'agente del 1/1/2026 ---\n";

const fb = (o) => ({
  _id: o.id, seq: o.seq, subSeq: 0, name: o.id, text: `Segnalazione ${o.id}`,
  clientId: o.clientId || 'utente-esterno-1', createdAt: o.at,
  status: o.status || 'todo', notes: o.notes || '', images: [], priority: 0,
});

const TRE = [
  fb({ id: 'a', seq: 1, at: iso(1), status: 'done', notes: `R.${TURNO}${PASS}` }),
  fb({ id: 'b', seq: 2, at: iso(1) }),
  fb({ id: 'c', seq: 3, at: iso(2), status: 'working' }),
];

async function pronta(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
}
const numero = (page) => page.locator('#mgStTileRicevuti [data-num]');

// ── La scheda aperta segue i dati, in tutti e due i versi ──────────────────

test('i feedback che arrivano a scheda già aperta compaiono, senza dover uscire e rientrare', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  // Si apre la scheda PRIMA che i feedback ci siano: è quello che succede a
  // chi entra in gestione e clicca subito «Statistiche feedback».
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await expect(page.locator('#mgStNoData')).toBeVisible();
  await expect(numero(page)).toHaveText('—');

  await page.evaluate((d) => window.__mgTest.setData(d), TRE);

  // Senza toccare niente: i numeri ci sono e l'avviso è sparito.
  await expect(numero(page)).toHaveText('3');
  await expect(page.locator('#mgStNoData')).toBeHidden();
  await expect(page.locator('#mgStBody')).toBeVisible();
});

test('il caricamento che va male a scheda già aperta lo dice, invece di lasciare lì i numeri di prima', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), TRE);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(numero(page)).toHaveText('3');

  await page.evaluate(() => window.__mgTest.simulaCaricamentoFallito());

  // Tre numeri senza più niente sotto sarebbero peggio di uno zero: sembrano veri.
  await expect(numero(page)).toHaveText('—');
  await expect(page.locator('#mgStNoData')).toBeVisible();
  await expect(page.locator('#mgStBody')).toBeHidden();
});

// ── Tasto destro ──────────────────────────────────────────────────────────

test('il tasto destro offre le azioni del punto in cui hai premuto', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), TRE);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  const menu = page.locator('.mg-ctxmenu');

  // Sulla tessera: aprire il dettaglio e copiare il numero.
  await page.locator('#mgStTileRicevuti').click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('Apri il dettaglio per categoria');
  await expect(menu).toContainText('Copia il numero');
  await menu.locator('.sn-select-option', { hasText: 'Apri il dettaglio per categoria' }).click();
  await expect(page.locator('#mgStDrawer .mg-st-row')).not.toHaveCount(0);

  // Su una riga di ripartizione: vedere le segnalazioni che ha contato.
  await page.locator('#mgStDrawer .mg-st-row[data-open]').first().click({ button: 'right' });
  await expect(menu).toContainText('Mostra le segnalazioni contate');
  await menu.locator('.sn-select-option', { hasText: 'Mostra le segnalazioni contate' }).click();
  await expect(page.locator('#mgStDrawer .mg-st-item[data-id]').first()).toBeVisible();

  // Su una fetta della torta: le stesse azioni della sua voce di legenda.
  // La posa è quella del centro del cerchio spostata in alto, perché il centro
  // del rettangolo di una fetta può cadere fuori dalla fetta stessa.
  await page.locator('#mgStLoopChart [data-group]').first()
    .click({ button: 'right', position: { x: 90, y: 40 } });
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('Copia');
  await page.keyboard.press('Escape');

  // Nell'angolo del riquadro della torta, fuori dal cerchio: prima lì non
  // usciva niente del tutto.
  await page.locator('#mgStLoopChart').click({ button: 'right', position: { x: 4, y: 4 } });
  await expect(menu).toContainText('Copia la ripartizione');
  await page.keyboard.press('Escape');

  // Su una barretta di «Quando arrivano»: restringere la finestra a quel
  // giorno. Si prende una barretta piena: quelle a zero sono alte due pixel.
  const barra = page.locator('#mgStSpark .mg-st-spark-bar:not(.mg-st-spark-bar--zero)').last();
  await barra.scrollIntoViewIfNeeded();
  await barra.click({ button: 'right' });
  const restringi = menu.locator('.sn-select-option', { hasText: 'Restringi la finestra' });
  await expect(restringi).toBeVisible();
  await restringi.click();
  await expect(page.locator('.mg-st-chip[data-window="custom"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mgStCustom')).toBeVisible();
});

test('il tasto destro sulla segnalazione di un elenco la apre', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), TRE);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.locator('#mgStTileRicevuti').click();
  await page.locator('#mgStDrawer .mg-st-row[data-open]').first().click();

  await page.locator('#mgStDrawer .mg-st-item[data-id]').first().click({ button: 'right' });
  const menu = page.locator('.mg-ctxmenu');
  await expect(menu).toContainText('Apri la segnalazione');
  await menu.locator('.sn-select-option', { hasText: /Apri la segnalazione/ }).click();
  await expect(page.locator('#panel-list')).toHaveClass(/mg-panel--active/);
  await expect(page.locator('#mgDetail')).toBeVisible();
});

test('dove la scheda non ha niente da offrire resta il menu generale di Filo', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), TRE);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.locator('.mg-st-intro').click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu')).toHaveCount(0);
});

// ── Le date ───────────────────────────────────────────────────────────────

test('la finestra personalizzata senza date dice cosa stai guardando, e le date scelte si rileggono col mese a parole', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), TRE);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();

  await page.locator('.mg-st-chip[data-window="custom"]').click();
  const nota = page.locator('#mgStWarn');
  await expect(nota).toBeVisible();
  // Non è un errore: i numeri sotto sono quelli di sempre, e la nota lo dice.
  await expect(nota).toContainText('sempre');
  await expect(numero(page)).toHaveText('3');

  // Scelte le date, l'ordine non si deve indovinare: il mese è scritto.
  await page.evaluate(() => window.__mgTest.setStatsWindow('custom', '2026-09-01', '2026-09-07'));
  const echo = page.locator('#mgStDateEcho');
  await expect(echo).toContainText('1 settembre 2026');
  await expect(echo).toContainText('7 settembre 2026');
  await expect(nota).toBeHidden();
});

test('il grafico degli arrivi non promette periodi che non sono ancora successi', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), [
    ...TRE, fb({ id: 'vecchio', seq: 9, at: iso(500) }),
  ]);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();

  for (const finestra of ['all', '30d']) {
    await page.evaluate((w) => window.__mgTest.setStatsWindow(w), finestra);
    const fine = await page.evaluate(() => {
      const barre = [...document.querySelectorAll('#mgStSpark .mg-st-spark-bar')];
      return { ultima: barre[barre.length - 1].dataset.to, asse: document.getElementById('mgStSparkAxis').innerText };
    });
    const oggi = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const oggiIso = `${oggi.getFullYear()}-${p(oggi.getMonth() + 1)}-${p(oggi.getDate())}`;
    expect(fine.ultima, `${finestra}: l'ultima barretta finisce oltre oggi`).toBe(oggiIso);
    expect(fine.asse).toContain(`${p(oggi.getDate())}/${p(oggi.getMonth() + 1)}/${oggi.getFullYear()}`);
  }

  // Anche sbagliando a digitare l'anno di partenza: la finestra dice «a oggi»
  // e l'asse deve finire lì, non nel 2028.
  const oggi = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const oggiIso = `${oggi.getFullYear()}-${p(oggi.getMonth() + 1)}-${p(oggi.getDate())}`;
  await page.evaluate((o) => window.__mgTest.setStatsWindow('custom', '1900-01-01', o), oggiIso);
  const ultima = await page.evaluate(() => {
    const barre = [...document.querySelectorAll('#mgStSpark .mg-st-spark-bar')];
    return barre[barre.length - 1].dataset.to;
  });
  expect(ultima).toBe(oggiIso);
});
