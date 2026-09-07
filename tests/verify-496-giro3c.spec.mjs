// #496 giro 3 — sonda mirata: cosa risponde il tasto destro dove la scheda non
// ha voci proprie, e le righe che non si aprono su niente.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ORA = new Date();
const iso = (g) => new Date(ORA.getTime() - g * 86400000).toISOString();
const PASS = 'Verifica superata. Provato tutto.';
const TURNO = "\n--- Aggiornamento dell'agente del 1/1/2026 ---\n";

const fb = (o) => ({
  _id: o.id, seq: o.seq, subSeq: 0, name: o.id, text: `Segnalazione ${o.id}`,
  clientId: 'utente-esterno-1', createdAt: o.at,
  status: o.status || 'todo', notes: o.notes || '', images: [], priority: o.priority || 0,
  _updateTime: 't1',
});
// Un feedback per ciascuno degli ultimi 6 giorni: così le barrette degli
// arrivi non sono tutte a zero e se ne può prendere una piena.
const DATI = [0, 1, 2, 3, 4, 5].map((g) => fb({
  id: `f${g}`, seq: g + 1, at: iso(g), priority: g % 4,
  status: g === 0 ? 'done' : 'todo', notes: g === 0 ? `R.${TURNO}${PASS}` : '',
}));

async function pronta(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
}

// Tasto destro VERO (nessun force): si prende il rettangolo e si preme dentro.
async function destroSu(page, sel, dentro) {
  const el = page.locator(sel).first();
  if (await el.count() === 0) return 'ELEMENTO ASSENTE';
  const b = await el.boundingBox();
  if (!b || b.width < 1 || b.height < 1) return `RETTANGOLO NULLO ${JSON.stringify(b)}`;
  const p = dentro || { x: b.width / 2, y: b.height / 2 };
  await page.mouse.click(b.x + p.x, b.y + p.y, { button: 'right' });
  await page.waitForTimeout(350);
  const testo = await page.evaluate(() => {
    const m = [...document.querySelectorAll('[class*="ctxmenu"], [class*="context-menu"], .sn-select-menu')]
      .filter((x) => x.offsetParent !== null);
    return m.length ? m.map((x) => x.innerText.replace(/\s*\n\s*/g, ' | ')).join(' ### ') : 'NESSUN MENU VISIBILE';
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  return testo;
}

test('sonda: tasto destro punto per punto', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), DATI);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await expect(page.locator('#mgStPies')).toBeVisible();

  const esiti = {};
  esiti['riga creatori (controllo: qui deve uscire)'] = await destroSu(page, '#mgStCreatorRows .mg-st-row');
  esiti['riga priorità alta'] = await destroSu(page, '#mgStHealthRows .mg-st-row');
  esiti['riga riaperture'] = await destroSu(page, '#mgStSignalRows .mg-st-row');
  esiti['titolo di una sezione'] = await destroSu(page, '#panel-fbstats h3');
  esiti['spazio bianco del pannello'] = await destroSu(page, '#panel-fbstats', { x: 4, y: 4 });

  // Le barrette: quella con più feedback dentro (non una a zero).
  const iPiena = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.mg-st-spark-bar')];
    let best = 0;
    b.forEach((x, i) => { if (Number(x.dataset.count || 0) > Number(b[best].dataset.count || 0)) best = i; });
    b[best].setAttribute('data-sonda', '1');
    return { indice: best, count: b[best].dataset.count, quante: b.length };
  });
  console.log('BARRETTA SCELTA →', JSON.stringify(iPiena));
  esiti['barretta arrivi piena'] = await destroSu(page, '.mg-st-spark-bar[data-sonda]');
  esiti['barretta arrivi a zero'] = await destroSu(page, '.mg-st-spark-bar:not([data-sonda])');
  const misure = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.mg-st-spark-bar')].slice(0, 3);
    return b.map((x) => ({ count: x.dataset.count, h: Math.round(x.getBoundingClientRect().height), w: +x.getBoundingClientRect().width.toFixed(1) }));
  });
  console.log('MISURE BARRETTE →', JSON.stringify(misure));
  console.log('SONDA TASTO DESTRO →', JSON.stringify(esiti, null, 2));
});
