// Verifica #496 giro 3 — seconda tornata: dove ESATTAMENTE finisce il guasto
// del registro, tenuta visiva (chiaro/scuro/stretto) e qualche porta adiacente.

import { test, expect } from './fixtures/electron.mjs';
import fs from 'node:fs';

const URL = 'filo://manage/manage.html';
const OUT = 'tests/.shots';
const ORA = new Date();
const iso = (g) => new Date(ORA.getTime() - g * 86400000).toISOString();
const PASS = 'Verifica superata. Provato tutto.';
const TURNO = "\n--- Aggiornamento dell'agente del 1/1/2026 ---\n";
const CRIT = (n) => Array.from({ length: n }, () => `${TURNO}Verifica: 1 rilievo. Il verificatore corregge.`).join('');

const fb = (o) => ({
  _id: o.id, seq: o.seq, subSeq: 0, name: o.name || o.id, text: `Segnalazione ${o.id}`,
  clientId: o.clientId || 'utente-esterno-1', createdAt: o.at,
  status: o.status || 'todo', notes: o.notes || '', images: [], priority: o.priority || 0,
  _updateTime: 't1',
});

const DATI = [
  fb({ id: 'a', seq: 1, at: iso(1), status: 'done', notes: `R.${TURNO}${PASS}` }),
  fb({ id: 'b', seq: 2, at: iso(1) }),
  fb({ id: 'c', seq: 3, at: iso(2), status: 'working', notes: `R.${CRIT(2)}${TURNO}${PASS}` }),
  fb({ id: 'd', seq: 4, at: iso(5), status: 'done', notes: `R.${CRIT(1)}${TURNO}Verifica: 2 rilievi. Il lavoro si ferma.` }),
];

async function pronta(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
}
async function stubRegistro(page) {
  await page.evaluate(() => {
    const vero = window.filo.message.bind(window.filo);
    window.__reg = { chiamate: 0, entries: [], fail: null };
    window.filo.message = (msg) => {
      if (msg && msg.type === 'worker_log_get') {
        window.__reg.chiamate += 1;
        if (window.__reg.fail) return Promise.resolve({ ok: false, error: window.__reg.fail });
        return Promise.resolve({ ok: true, entries: window.__reg.entries.slice() });
      }
      return vero(msg);
    };
  });
}
const run = (ruolo, g) => ({ role: ruolo, startedAt: new Date(ORA.getTime() - g * 86400000).toISOString(), num: '#1' });

test('dove finisce il guasto del registro: cosa legge chi guarda la tessera', async ({ openTab }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const page = await openTab(URL);
  await pronta(page);
  await stubRegistro(page);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((d) => window.__mgTest.setData(d), DATI);
  await page.evaluate(() => { window.__reg.fail = 'non raggiungibile'; });
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await expect(page.locator('#mgStTileProber [data-num]')).toBeVisible();

  const letto = await page.evaluate(() => ({
    prober: document.querySelector('#mgStTileProber [data-num]').textContent,
    proberSub: document.querySelector('#mgStTileProber [data-sub]').textContent,
    ricevuti: document.querySelector('#mgStTileRicevuti [data-num]').textContent,
    ricevutiSub: document.querySelector('#mgStTileRicevuti [data-sub]').textContent,
    riga: document.querySelector('#mgStRange').textContent,
  }));
  console.log('GUASTO REGISTRO →', JSON.stringify(letto, null, 2));
  await page.screenshot({ path: `${OUT}/496g3-registro-guasto.png`, fullPage: false });
});

test('tenuta visiva: chiaro, scuro, e finestra stretta', async ({ openTab }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const page = await openTab(URL);
  await pronta(page);
  await stubRegistro(page);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((r) => { window.__reg.entries = r; },
    [run('prober', 1), run('prober', 2), run('resolver', 1), run('verifier', 3)]);
  await page.evaluate((d) => window.__mgTest.setData(d), DATI);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await expect(page.locator('#mgStPies')).toBeVisible();
  await page.screenshot({ path: `${OUT}/496g3-chiaro.png` });

  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); document.body.setAttribute('data-theme', 'dark'); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/496g3-scuro.png` });
  await page.evaluate(() => { document.documentElement.removeAttribute('data-theme'); document.body.removeAttribute('data-theme'); });

  await page.setViewportSize({ width: 620, height: 900 });
  await page.waitForTimeout(300);
  const sborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  await page.screenshot({ path: `${OUT}/496g3-stretto.png`, fullPage: true });
  expect(sborda).toBe(false);
});

test('la scheda aperta segue anche la sparizione di un feedback e il gruppo aperto sotto', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await page.evaluate((d) => window.__mgTest.setData(d), DATI);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.locator('#mgStTileRicevuti').click();
  await page.locator('#mgStDrawer .mg-st-row[data-open]').first().click();
  await expect(page.locator('#mgStDrawer .mg-st-item').first()).toBeVisible();
  // Uno dei feedback sparisce mentre l'elenco è aperto sotto il numero.
  await page.evaluate((d) => window.__mgTest.setData(d), DATI.slice(1));
  await expect(page.locator('#mgStTileRicevuti [data-num]')).toHaveText('3');
  const testo = await page.locator('#panel-fbstats').innerText();
  expect(testo).not.toMatch(/undefined|NaN|\[object/);
});

test('il tasto destro dà una risposta su ogni pezzo nuovo della scheda', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await stubRegistro(page);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((r) => { window.__reg.entries = r; }, [run('prober', 1), run('resolver', 1)]);
  await page.evaluate((d) => window.__mgTest.setData(d), DATI);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await expect(page.locator('#mgStPies')).toBeVisible();
  const menu = page.locator('.mg-ctxmenu');

  const punti = [
    ['tessera prober', '#mgStTileProber'],
    ['pulsante finestra', '.mg-st-chip[data-window="7d"]'],
    ['pulsante creatore', '.mg-st-chip[data-creator]'],
    ['voce di legenda', '#mgStLoopLegend li'],
    ['fetta di torta', '#mgStLoopChart [data-group]'],
    ['barretta arrivi', '.mg-st-spark-bar'],
    ['riga priorità', '#mgStHealthRows .mg-st-row'],
    ['riga segnali', '#mgStSignalRows .mg-st-row'],
    ['riga creatori', '#mgStCreatorRows .mg-st-row'],
  ];
  const esiti = {};
  for (const [nome, sel] of punti) {
    const el = page.locator(sel).first();
    if (await el.count() === 0) { esiti[nome] = 'ASSENTE'; continue; }
    await el.click({ button: 'right' });
    await page.waitForTimeout(250);
    esiti[nome] = (await menu.count()) && await menu.isVisible()
      ? (await menu.innerText()).replace(/\s*\n\s*/g, ' | ')
      : 'NESSUN MENU';
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
  }
  console.log('TASTO DESTRO →', JSON.stringify(esiti, null, 2));
});
