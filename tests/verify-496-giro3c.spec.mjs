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
const DATI = [
  fb({ id: 'a', seq: 1, at: iso(1), status: 'done', priority: 3, notes: `R.${TURNO}${PASS}` }),
  fb({ id: 'b', seq: 2, at: iso(1), priority: 3 }),
  fb({ id: 'c', seq: 3, at: iso(2), priority: 2, status: 'working' }),
  fb({ id: 'd', seq: 4, at: iso(3), priority: 1 }),
];

async function pronta(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
}

test('sonda: tasto destro punto per punto, con qualunque menu compaia', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), DATI);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await expect(page.locator('#mgStPies')).toBeVisible();

  const punti = [
    ['spazio bianco della scheda', '#panel-fbstats > *:last-child'],
    ['titolo di sezione', '#panel-fbstats h3'],
    ['riga priorità alta', '#mgStHealthRows .mg-st-row'],
    ['riga riaperture', '#mgStSignalRows .mg-st-row'],
    ['barretta arrivi', '.mg-st-spark-bar'],
    ['riga creatori', '#mgStCreatorRows .mg-st-row'],
  ];
  const esiti = {};
  for (const [nome, sel] of punti) {
    const el = page.locator(sel).first();
    if (await el.count() === 0) { esiti[nome] = 'ELEMENTO ASSENTE'; continue; }
    try { await el.click({ button: 'right', force: true, timeout: 4000 }); }
    catch (e) { esiti[nome] = 'CLIC IMPOSSIBILE: ' + String(e.message).split('\n')[0]; continue; }
    await page.waitForTimeout(300);
    esiti[nome] = await page.evaluate(() => {
      const menus = [...document.querySelectorAll('.mg-ctxmenu, .sn-ctxmenu, .filo-ctxmenu, [class*="ctxmenu"], [class*="context-menu"]')]
        .filter((m) => m.offsetParent !== null);
      return menus.length ? menus.map((m) => m.innerText.replace(/\s*\n\s*/g, ' | ')).join(' ### ') : 'NESSUN MENU VISIBILE';
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  console.log('SONDA TASTO DESTRO →', JSON.stringify(esiti, null, 2));

  // Le righe che rappresentano segnalazioni si aprono su quelle segnalazioni?
  const apribili = await page.evaluate(() => {
    const q = (sel) => [...document.querySelectorAll(sel)].map((r) => ({
      testo: (r.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      apribile: !!(r.dataset.open || r.dataset.goto),
    }));
    return {
      priorita: q('#mgStHealthRows .mg-st-row'),
      segnali: q('#mgStSignalRows .mg-st-row'),
      creatori: q('#mgStCreatorRows .mg-st-row'),
    };
  });
  console.log('RIGHE APRIBILI →', JSON.stringify(apribili, null, 2));

  // Clic sinistro su «Priorità alta»: succede qualcosa?
  const prima = await page.locator('#panel-fbstats').innerText();
  await page.locator('#mgStHealthRows .mg-st-row').first().click({ force: true });
  await page.waitForTimeout(300);
  const dopo = await page.locator('#panel-fbstats').innerText();
  console.log('CLIC SU PRIORITÀ ALTA CAMBIA QUALCOSA →', prima !== dopo);
});
