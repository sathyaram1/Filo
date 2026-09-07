// #496 — terzo affondo: la CAUSA del blocco della scheda, e i resti delle date.

import { test, expect } from './fixtures/electron.mjs';
import fs from 'node:fs';

const URL = 'filo://manage/manage.html';
const ORA = new Date();
const iso = (g) => new Date(ORA.getTime() - g * 86400000).toISOString();
const fb = (o) => ({
  _id: o.id, seq: o.seq, subSeq: 0, name: o.id, text: `x ${o.id}`,
  clientId: 'utente-esterno-1', createdAt: o.at, status: o.status || 'todo',
  notes: '', images: [], priority: 0,
});

// La scheda si blocca su quello che aveva quando è stata aperta: è un problema
// di RIDISEGNO, non di dati. Se cambiando scheda e tornando indietro i numeri
// compaiono, i dati c'erano già ed è il ridisegno a non essere mai ripartito.
test('la scheda aperta prima dei dati resta ferma: basta cambiare scheda e tornare?', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);

  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 'a', seq: 1, at: iso(1) }), fb({ id: 'b', seq: 2, at: iso(1) }),
    fb({ id: 'c', seq: 3, at: iso(2) }),
  ]);
  await page.waitForTimeout(1200);
  const bloccata = await page.evaluate(() => ({
    ricevuti: document.querySelector('#mgStTileRicevuti [data-num]').textContent,
    corpoNascosto: document.getElementById('mgStBody').hidden,
    avviso: document.getElementById('mgStNoData').hidden ? '' : 'c\'è',
    // I dati SONO in pagina: le schede-lista in cima li contano già.
    schedaRicevuti: document.querySelector('.mg-tab[data-tab="inbox"]').textContent.trim(),
  }));
  console.log('CON LA SCHEDA APERTA:', JSON.stringify(bloccata));
  fs.mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/496g3-bloccata.png', fullPage: true });

  // Ora si cambia scheda e si torna: se qui i numeri arrivano, i dati c'erano.
  await page.locator('.mg-tab[data-tab="inbox"]').click();
  await page.waitForTimeout(200);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.waitForTimeout(600);
  const sbloccata = await page.evaluate(() => ({
    ricevuti: document.querySelector('#mgStTileRicevuti [data-num]').textContent,
    corpoNascosto: document.getElementById('mgStBody').hidden,
  }));
  console.log('DOPO ESSERE USCITI E RIENTRATI:', JSON.stringify(sbloccata));
  await page.screenshot({ path: 'tests/.shots/496g3-sbloccata.png', fullPage: true });

  // La prova della causa: gli stessi dati, la stessa finestra, due risultati
  // diversi a seconda di quando si è aperta la scheda.
  expect(sbloccata.ricevuti).toBe('3');
  expect(bloccata.ricevuti, 'la scheda aperta prima dei dati mostra gli stessi numeri di quella riaperta dopo').toBe(sbloccata.ricevuti);
});

test('date personalizzate: l asse dice la stessa finestra della riga sopra?', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 'a', seq: 1, at: iso(1) }), fb({ id: 'b', seq: 2, at: iso(400) }),
  ]);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await expect(page.locator('#panel-fbstats')).toHaveClass(/mg-panel--active/);

  const oggi = new Date().toISOString().slice(0, 10);
  const ieri = new Date(ORA.getTime() - 86400000).toISOString().slice(0, 10);

  for (const [nome, da, a] of [
    ['dal 1900', '1900-01-01', oggi],
    ['invertite', oggi, ieri],
    ['solo dal', '2026-01-01', ''],
    ['solo al', '', oggi],
    ['nessuna', '', ''],
  ]) {
    await page.evaluate((v) => window.__mgTest.setStatsWindow('custom', v.da, v.a), { da, a });
    await page.waitForTimeout(250);
    const s = await page.evaluate(() => ({
      ricevuti: document.querySelector('#mgStTileRicevuti [data-num]').textContent,
      riga: document.getElementById('mgStRange').textContent.trim(),
      asse: document.getElementById('mgStSparkAxis').innerText.replace(/\n/g, ' → '),
      avviso: document.getElementById('mgStWarn').hidden ? '' : document.getElementById('mgStWarn').textContent.trim(),
    }));
    console.log(`DATE «${nome}»:`, JSON.stringify(s));
  }

  // Con «Sempre» su dati normali: l'asse finisce oltre oggi?
  await page.evaluate(() => window.__mgTest.setStatsWindow('all'));
  await page.waitForTimeout(250);
  const sempre = await page.evaluate(() => ({
    riga: document.getElementById('mgStRange').textContent.trim(),
    asse: document.getElementById('mgStSparkAxis').innerText.replace(/\n/g, ' → '),
  }));
  console.log('SEMPRE:', JSON.stringify(sempre));
});
