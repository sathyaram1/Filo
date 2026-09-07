// #496 giro 6 — ultime due prove: la fetta di torta col clic sinistro, e il
// messaggio «Copiato: …» che entra nel flusso della pagina.

import { test, expect } from './fixtures/electron.mjs';

// Nota: questi due sono DIAGNOSTICI (rilievi di livello 0): misurano e scrivono
// nel log, senza diventare rossi, così non restano appesi se l'owner decide di
// lasciare le cose come stanno.

const PAGINA = 'filo://manage/manage.html';
const ORA = new Date();
const iso = (g) => new Date(ORA.getTime() - g * 86400000).toISOString();
const T = "\n--- Aggiornamento dell'agente del 1/1/2026 ---\n";
const CRIT = 'Verifica: 1 rilievo.\nIl verificatore corregge tutti i rilievi; poi un altro verificatore ricontrolla.\n- [1] x';
const PASS = 'Verifica superata.';

const fb = (o) => ({
  _id: o.id, seq: o.seq, subSeq: 0, name: o.id, text: 't',
  clientId: o.clientId || 'owner:pino', createdAt: o.at,
  status: o.status || 'todo', notes: o.notes || '', images: [], priority: o.priority || 0,
});

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 'a', seq: 1, at: iso(1), status: 'done', notes: `R.${T}${PASS}` }),
    fb({ id: 'b', seq: 2, at: iso(2), status: 'done', notes: `R.${T}${CRIT}${T}${PASS}` }),
    fb({ id: 'c', seq: 3, at: iso(3), status: 'todo', priority: 3 }),
  ]);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.waitForTimeout(150);
}

test('fetta di torta: il clic sinistro fa quello che fa la sua voce di legenda?', async ({ openTab }) => {
  const page = await openTab(PAGINA);
  await apri(page);
  const fetta = page.locator('#mgStLoopChart [data-group]').first();
  const gruppo = await fetta.getAttribute('data-group');
  console.log('[giro6c] fetta:', gruppo,
    '| cursore:', await fetta.evaluate((el) => getComputedStyle(el).cursor));
  const aperti = () => page.locator('#mgStLoopLegend .mg-st-legend-items').count();
  console.log('[giro6c] elenchi aperti all\'inizio:', await aperti());
  await fetta.click({ force: true });
  await page.waitForTimeout(200);
  const dopoFetta = await aperti();
  console.log('[giro6c] dopo il clic SULLA FETTA:', dopoFetta);
  await page.locator(`#mgStLoopLegend li[data-group="${gruppo}"]`).click();
  await page.waitForTimeout(200);
  const dopoLegenda = await aperti();
  console.log('[giro6c] dopo il clic SULLA LEGENDA gemella:', dopoLegenda);
  // Diagnostico: la differenza fra i due cammini si LEGGE nei log qui sopra.
  expect(dopoLegenda).toBeGreaterThanOrEqual(dopoFetta);
});

test('«Copiato: …»: il messaggio fa saltare la pagina?', async ({ openTab }) => {
  const page = await openTab(PAGINA);
  await apri(page);
  const misura = () => page.evaluate(() => {
    const s = document.querySelector('#mgStHealthRows .mg-st-row');
    return s ? Math.round(s.getBoundingClientRect().top) : null;
  });
  const prima = await misura();
  await page.evaluate(() => {
    const p = document.getElementById('mgStFlash');
    p.textContent = 'Copiato: Priorità alta (3): 1';
    p.hidden = false;
  });
  await page.waitForTimeout(120);
  const dopo = await misura();
  console.log('[giro6c] «Salute della coda» prima:', prima, '· col messaggio:', dopo,
    '· salto:', dopo - prima, 'px');
  // Diagnostico: il salto in pixel si legge nel log qui sopra.
  expect(typeof (dopo - prima)).toBe('number');
});
