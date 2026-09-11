// Verifica #496 — giro 15. «Prober lanciati», il tetto del caricamento e la
// memoria della scheda.
//
// «Prober lanciati» è uno dei tre numeri che la segnalazione chiedeva, ed è
// l'unico che viene da una sorgente diversa dai feedback: il registro delle
// partenze delle routine, che dal contenitore resta riservato. Qui il registro
// si INIETTA, così la tessera si può finalmente guardare accesa.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();
const isoH = (h) => new Date(ora - h * 3600 * 1000).toISOString();

const FB = [
  { _id: 'a', seq: 901, subSeq: 0, clientId: 'tester@example.com', name: 'uno', text: 'uno', status: 'done', createdAt: iso(3), _updateTime: iso(1), resolvedInVersion: '1.0.0', notes: 'Verifica superata.' },
  { _id: 'b', seq: 902, subSeq: 0, clientId: 'routine:prober', name: 'due', text: 'due', status: 'todo', createdAt: iso(2) },
];

const REGISTRO = [
  { role: 'prober', startedAt: isoH(2), num: '#901' },
  { role: 'prober', startedAt: isoH(30), num: '#902' },
  { role: 'verifier', startedAt: isoH(3), num: '#901' },
  { role: 'new-work', startedAt: isoH(4), num: '#901' },
  { role: '', startedAt: isoH(5), num: '' },
  { role: 'ruolo-mai-visto', startedAt: isoH(6), num: '#903' },
];

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
}

function leggi(page) {
  return page.evaluate(() => {
    const t = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
    const card = document.querySelector('[data-card="routine"]');
    return {
      tessera: t(card),
      valore: t(card && card.querySelector('.mg-st-card-value')),
      righe: Array.from(card ? card.querySelectorAll('.mg-st-row, .mg-st-empty') : []).map(t),
      altre: Array.from(document.querySelectorAll('#mgStMore .mg-st-row, #mgStMore div, #mgStMore li')).map(t).filter(Boolean),
      avviso: t(document.getElementById('mgStNote')),
    };
  });
}

test('il registro acceso: il numero grande, la ripartizione, i ruoli ignoti', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.evaluate((l) => window.__mgTest.setData(l), FB);
  await page.evaluate((l) => window.__mgTest.renderWorkerLog(l), REGISTRO);
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.locator('[data-card-toggle="routine"]').click();
  await page.waitForTimeout(200);
  console.log('REGISTRO/all ' + JSON.stringify(await leggi(page), null, 1));

  await page.evaluate(() => window.__mgTest.setStatsWindow('24h'));
  await page.waitForTimeout(150);
  console.log('REGISTRO/24h ' + JSON.stringify(await leggi(page), null, 1));

  // Il filtro per creatore non tocca il registro: la tessera lo dichiara?
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.evaluate(() => window.__mgTest.setStatsCreators(['user']));
  await page.waitForTimeout(150);
  console.log('REGISTRO/filtro-utente ' + JSON.stringify(await leggi(page), null, 1));

  await page.screenshot({ path: 'tests/.shots/496-giro15-registro.png', fullPage: true });
});

test('il registro vuoto e il registro che non arriva', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.evaluate((l) => window.__mgTest.setData(l), FB);
  await page.evaluate(() => window.__mgTest.renderWorkerLog([]));
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.locator('[data-card-toggle="routine"]').click();
  await page.waitForTimeout(200);
  console.log('REGISTRO VUOTO ' + JSON.stringify(await leggi(page), null, 1));
});

test('il tetto del caricamento: i numeri dicono di essere minimi', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  const molti = [];
  for (let k = 0; k < 520; k += 1) {
    molti.push({
      _id: `x${k}`, seq: 1000 + k, subSeq: 0,
      clientId: k % 2 ? 'tester@example.com' : 'routine:prober',
      name: `segnalazione ${k}`, text: `segnalazione ${k}`,
      status: k % 3 === 0 ? 'done' : 'todo',
      createdAt: iso(k % 40),
      _updateTime: iso(1),
      resolvedInVersion: k % 3 === 0 ? '1.0.0' : undefined,
      notes: k % 3 === 0 ? 'Verifica superata.' : '',
    });
  }
  await page.evaluate((l) => window.__mgTest.setData(l), molti);
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({
    tessere: Array.from(document.querySelectorAll('#mgStCards .mg-st-card-value')).map((e) => e.textContent.trim()),
    avviso: (document.getElementById('mgStNote') || {}).textContent.replace(/\s+/g, ' ').trim(),
    barre: (document.getElementById('mgStBarsNote') || {}).textContent.replace(/\s+/g, ' ').trim(),
  }));
  console.log('TETTO ' + JSON.stringify(r, null, 1));
  // l'elenco dietro un numero grande: quante voci, e cosa dice la coda
  await page.locator('[data-drill="tessera:ricevuti"]').first().click();
  await page.waitForTimeout(300);
  const d = await page.evaluate(() => {
    const box = document.querySelector('#panel-fbstats .mg-st-drill');
    return {
      voci: box ? box.querySelectorAll('button').length : null,
      coda: box ? (box.querySelector('.mg-st-empty') || {}).textContent : null,
    };
  });
  console.log('ELENCO LUNGO ' + JSON.stringify(d));
});

test('la scheda si ricorda finestra e filtro fra due aperture', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.evaluate((l) => window.__mgTest.setData(l), FB);
  await page.locator('[data-window="7d"]').click();
  await page.locator('#mgStCreators [data-creator="prober"]').click();
  await page.waitForTimeout(250);
  const prima = await page.evaluate(() => Array.from(document.querySelectorAll('#mgStWindows .mg-st-chip--on, #mgStCreators .mg-st-chip--on')).map((e) => e.textContent.trim()));
  console.log('PRIMA ' + JSON.stringify(prima));

  const page2 = await openTab(URL);
  await apri(page2);
  await page2.evaluate((l) => window.__mgTest.setData(l), FB);
  await page2.waitForTimeout(400);
  const dopo = await page2.evaluate(() => Array.from(document.querySelectorAll('#mgStWindows .mg-st-chip--on, #mgStCreators .mg-st-chip--on')).map((e) => e.textContent.trim()));
  console.log('DOPO ' + JSON.stringify(dopo));
});
