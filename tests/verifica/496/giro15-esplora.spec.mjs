// Verifica #496 — giro 15. Esplorazione della scheda «Statistiche feedback».
//
// Non asserisce quasi niente: apre la scheda con un insieme di lavorazioni
// costruito a mano e STAMPA cosa si legge, per poterlo confrontare con quello
// che la segnalazione chiedeva. Serve a guardare, non a sorvegliare.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ora = Date.now();
const iso = (g) => new Date(ora - g * 24 * 3600 * 1000).toISOString();
const AG = (t) => `--- Aggiornamento dell'agente del ${t} ---`;

const FIX = 'La correzione riguarda tutti i rilievi; poi un\'altra verifica ricontrolla.';
const STOP = 'Il lavoro si ferma: c\'è un rilievo di livello 2 o 3 che non si può correggere da soli.';
const RIM = 'Nessun rilievo da correggere adesso: restano a un feedback derivato.';

function verbale(esito, livelli) {
  const n = livelli.length;
  return [
    `Verifica: ${n} ${n === 1 ? 'rilievo' : 'rilievi'}.`,
    'Provato: tutto quanto, e funziona.',
    esito,
    ...livelli.map((l, i) => `- [${l}] rilievo ${i + 1}`),
  ].join('\n');
}

function conversazione(giri, finale) {
  const turni = [];
  for (let k = 0; k < giri; k += 1) {
    turni.push(`${AG(`0${k + 1}/09/2026, 10:00`)}\n${verbale(FIX, [1, 0])}`);
    turni.push(`${AG(`0${k + 1}/09/2026, 12:00`)}\nCorretto.`);
  }
  turni.push(`${AG('08/09/2026, 10:00')}\n${finale}`);
  return turni.join('\n\n');
}

function lavoro(o) {
  return Object.assign({
    _id: o.id, seq: o.seq, subSeq: 0, clientId: o.clientId || 'tester@example.com',
    name: o.name || `lavoro ${o.seq}`, text: o.name || `lavoro ${o.seq}`,
    status: 'done', createdAt: iso(o.natoDa ?? 9), _updateTime: iso(o.mossoDa ?? 1),
    resolvedInVersion: '1.0.0', notes: o.notes || '',
  }, o.extra || {});
}

const INSIEME = [
  lavoro({ id: 'a', seq: 901, notes: conversazione(0, 'Verifica superata.') }),
  lavoro({ id: 'b', seq: 902, notes: conversazione(1, 'Verifica superata.'), clientId: 'routine:prober' }),
  lavoro({ id: 'c', seq: 903, notes: conversazione(2, 'Verifica superata.'), clientId: 'routine:verifier' }),
  lavoro({ id: 'd', seq: 904, notes: `${AG('02/09/2026, 10:00')}\n${verbale(STOP, [2])}`, clientId: 'owner:x' }),
  lavoro({ id: 'e', seq: 905, notes: `${AG('02/09/2026, 10:00')}\n${verbale(RIM, [0, 0])}`, clientId: 'agent:kimi' }),
  lavoro({ id: 'f', seq: 906, notes: '', clientId: 'routine:residuo' }),
  { _id: 'g', seq: 907, subSeq: 0, clientId: 'tester2@example.com', name: 'in coda', text: 'in coda', status: 'todo', createdAt: iso(3) },
  { _id: 'h', seq: 908, subSeq: 0, clientId: 'local:sessione', name: 'in lavorazione', text: 'in lavorazione', status: 'working', createdAt: iso(2) },
];

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);
}

async function leggi(page) {
  return page.evaluate(() => {
    const t = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
    const tutti = (sel) => Array.from(document.querySelectorAll(sel)).map(t);
    return {
      finestre: tutti('#mgStWindows .mg-st-chip'),
      creatori: tutti('#mgStCreators .mg-st-chip'),
      tessere: tutti('#mgStCards .mg-st-card'),
      avviso: t(document.getElementById('mgStNote')),
      torta: tutti('#mgStPieLegend li'),
      tortaNota: t(document.getElementById('mgStPieNote')),
      tortaTitoli: tutti('#panel-fbstats .mg-st-sec-title'),
      barre: t(document.getElementById('mgStBarsNote')),
      altre: tutti('#mgStMore .mg-st-row, #mgStMore li, #mgStMore tr'),
    };
  });
}

test('cosa si legge nella scheda', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.evaluate((l) => window.__mgTest.setData(l), INSIEME);
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(200);
  console.log('SCHEDA ' + JSON.stringify(await leggi(page), null, 1));

  // apri tutte le tessere
  for (const id of ['ricevuti', 'lavorati', 'routine', 'adesso']) {
    const b = page.locator(`[data-card-toggle="${id}"]`);
    if (await b.count()) {
      const aperto = await b.getAttribute('aria-expanded');
      if (aperto !== 'true') await b.click();
    }
  }
  await page.waitForTimeout(150);
  console.log('APERTE ' + JSON.stringify((await leggi(page)).tessere, null, 1));
});

test('finestre e filtro creatore', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.evaluate((l) => window.__mgTest.setData(l), INSIEME);
  for (const k of ['24h', '7d', '30d', '90d', '365d', 'all']) {
    await page.evaluate((key) => window.__mgTest.setStatsWindow(key), k);
    await page.waitForTimeout(80);
    const r = await leggi(page);
    console.log(`FINESTRA ${k}: ${JSON.stringify(r.tessere)} | ${r.avviso}`);
  }
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  for (const c of [['prober'], ['verifier'], ['owner'], ['user'], ['local'], ['residuo'], ['claude'], []]) {
    await page.evaluate((l) => window.__mgTest.setStatsCreators(l), c);
    await page.waitForTimeout(80);
    const r = await leggi(page);
    console.log(`CREATORI ${JSON.stringify(c)}: ${JSON.stringify(r.tessere)} | torta=${JSON.stringify(r.torta)}`);
  }
});

test('stato vuoto e dati che non arrivano', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(150);
  console.log('VUOTO ' + JSON.stringify(await leggi(page), null, 1));
  await page.evaluate(() => window.__mgTest.simulaCaricamentoFallito());
  await page.waitForTimeout(150);
  console.log('FALLITO ' + JSON.stringify(await leggi(page), null, 1));
});

test('traccia visiva: chiaro, scuro, finestra stretta', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page);
  await page.evaluate((l) => window.__mgTest.setData(l), INSIEME);
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  for (const id of ['lavorati', 'routine', 'adesso']) {
    const b = page.locator(`[data-card-toggle="${id}"]`);
    if (await b.count()) await b.click();
  }
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'tests/.shots/496-giro15-chiaro.png', fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/.shots/496-giro15-scuro.png', fullPage: true });
  await page.setViewportSize({ width: 620, height: 900 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/496-giro15-stretto.png', fullPage: true });
});
