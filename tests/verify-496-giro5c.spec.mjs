// #496 giro 5 — terza tornata: parità fra i cammini. Su ogni elemento della
// scheda che porta un numero, il clic sinistro e il tasto destro devono
// rispondere la stessa cosa.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ORA = new Date();
const iso = (g) => new Date(ORA.getTime() - g * 86400000).toISOString();
const PASS = 'Verifica superata.';
const TURNO = "\n--- Aggiornamento dell'agente del 1/1/2026 ---\n";
const CRIT = (n) => Array.from({ length: n }, () => `${TURNO}Verifica: 1 rilievi. Il verificatore corregge.`).join('');

const fb = (o) => ({
  _id: o.id, seq: o.seq, subSeq: 0, name: o.name || o.id, text: `Segnalazione ${o.id}`,
  clientId: o.clientId || 'utente-esterno-1', createdAt: o.at,
  status: o.status || 'todo', notes: o.notes || '', images: [], priority: o.priority || 0,
  _updateTime: 't1',
});

const DATI = [
  fb({ id: 'a', seq: 1, at: iso(1), status: 'done', notes: `R.${TURNO}${PASS}` }),
  fb({ id: 'b', seq: 2, at: iso(1), status: 'done', notes: `R.${CRIT(1)}${TURNO}${PASS}` }),
  fb({ id: 'c', seq: 3, at: iso(2), status: 'done', notes: `R.${CRIT(2)}${TURNO}${PASS}` }),
  fb({ id: 'd', seq: 4, at: iso(3), status: 'working', notes: `R.${TURNO}Verifica: 2 rilievi. Il lavoro si ferma: serve l'owner.` }),
  fb({ id: 'e', seq: 5, at: iso(3), status: 'todo' }),
];

async function pronta(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
}
async function apri(page) {
  await page.evaluate((d) => window.__mgTest.setData(d), DATI);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.waitForTimeout(150);
}
const vociMenu = (page) => page.locator('.sn-ctx-item, .sn-menu-item, [class*="ctx"] li, [class*="menu"] button');

test('fetta di torta: clic sinistro contro tasto destro', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await apri(page);

  const fette = page.locator('#mgStLoopChart [data-group]');
  console.log('fette:', await fette.count());
  const fetta = fette.first();
  console.log('gruppo:', await fetta.getAttribute('data-group'));
  console.log('cursor sulla fetta:', await fetta.evaluate((el) => getComputedStyle(el).cursor));

  // clic SINISTRO sulla fetta
  const primaClic = await page.locator('#mgStLoopLegend .mg-st-legend-items').count();
  await fetta.click({ force: true });
  await page.waitForTimeout(200);
  const dopoClic = await page.locator('#mgStLoopLegend .mg-st-legend-items').count();
  console.log('elenchi aperti: prima', primaClic, '→ dopo il clic sulla fetta', dopoClic);

  // clic SINISTRO sulla voce di legenda gemella
  await page.locator('#mgStLoopLegend li[data-group]').first().click();
  await page.waitForTimeout(200);
  console.log('dopo il clic sulla LEGENDA:', await page.locator('#mgStLoopLegend .mg-st-legend-items').count());

  // tasto destro sulla fetta
  await fetta.click({ button: 'right', force: true });
  await page.waitForTimeout(250);
  const menu = await page.evaluate(() => {
    const n = document.querySelector('.sn-ctx, .sn-context-menu, [data-ctx], .mg-ctx');
    if (n) return n.innerText;
    // ripiego: qualunque elemento comparso in position:fixed con voci
    const cand = [...document.querySelectorAll('body > div')].filter((d) => {
      const s = getComputedStyle(d);
      return s.position === 'fixed' && d.offsetHeight > 10 && d.innerText.trim();
    });
    return cand.map((d) => d.innerText).join(' || ');
  });
  console.log('MENU sulla fetta:', JSON.stringify(menu));
});

test('barretta del grafico: clic sinistro contro tasto destro', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await apri(page);
  const barre = page.locator('#mgStSpark .mg-st-spark-bar');
  const conDati = barre.filter({ hasNot: page.locator('.mg-st-spark-bar--zero') });
  console.log('barre totali:', await barre.count());
  const b = page.locator('#mgStSpark .mg-st-spark-bar:not(.mg-st-spark-bar--zero)').last();
  console.log('title:', await b.getAttribute('title'), '| count:', await b.getAttribute('data-count'));
  console.log('cursor:', await b.evaluate((el) => getComputedStyle(el).cursor));
  const rigaPrima = (await page.locator('#mgStRange').textContent()).trim();
  await b.click({ force: true });
  await page.waitForTimeout(250);
  const rigaDopo = (await page.locator('#mgStRange').textContent()).trim();
  console.log('riga prima :', rigaPrima);
  console.log('riga dopo il clic:', rigaDopo, '| cambiata?', rigaPrima !== rigaDopo);
  await b.click({ button: 'right', force: true });
  await page.waitForTimeout(250);
  const menu = await page.evaluate(() => {
    const cand = [...document.querySelectorAll('body > div')].filter((d) => {
      const s = getComputedStyle(d);
      return s.position === 'fixed' && d.offsetHeight > 10 && d.innerText.trim();
    });
    return cand.map((d) => d.innerText).join(' || ');
  });
  console.log('MENU sulla barretta:', JSON.stringify(menu));
});

test('inventario: cosa si apre col clic sinistro', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await apri(page);
  await page.locator('#mgStTileRicevuti').click();
  const inv = await page.evaluate(() => {
    const out = [];
    const p = document.getElementById('panel-fbstats');
    for (const sel of ['.mg-st-tile', '.mg-st-row', '.mg-st-legend li[data-group]',
      '#mgStLoopChart [data-group]', '#mgStOutcomeChart [data-group]', '.mg-st-spark-bar']) {
      for (const el of p.querySelectorAll(sel)) {
        out.push({
          sel,
          testo: (el.textContent || el.getAttribute('data-group') || '').replace(/\s+/g, ' ').trim().slice(0, 40),
          apribile: !!(el.dataset.open || el.dataset.goto || el.dataset.stat || el.classList.contains('mg-st-tile')),
          ruolo: el.getAttribute('role') || '',
          cursor: getComputedStyle(el).cursor,
        });
      }
    }
    return out;
  });
  for (const r of inv) console.log(JSON.stringify(r));
});
